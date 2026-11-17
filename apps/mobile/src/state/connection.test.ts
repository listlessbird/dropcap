import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type { Connection } from "../lib/connection";
import { MailboxClient, MailboxError } from "../lib/mailboxClient";
import { ConnectionStore } from "../persistence/connection-store";
import { createConnectionState } from "./connection";

const LINK = "kindledrop://connect?server=https%3A%2F%2Fmailbox.example.dev&key=good";

const mountState = (acceptedKey: string) =>
  Effect.gen(function* () {
    const saved = yield* Ref.make(Option.none<Connection>());

    const layer = Layer.mergeAll(
      Layer.succeed(
        ConnectionStore,
        ConnectionStore.of({
          load: Ref.get(saved),
          save: (connection) => Ref.set(saved, Option.some(connection)),
          clear: Ref.set(saved, Option.none()),
        }),
      ),
      Layer.succeed(
        MailboxClient,
        MailboxClient.of({
          status: (connection) =>
            Redacted.value(connection.key) === acceptedKey
              ? Effect.succeed({ checkedInAt: Option.none<DateTime.Utc>(), waiting: [] })
              : Effect.fail(new MailboxError({ reason: "unauthorized", cause: null })),
          cancel: () => Effect.void,
          upload: () => Effect.die("Pairing never uploads."),
        }),
      ),
    );

    const state = createConnectionState(Atom.runtime(layer));
    const registry = AtomRegistry.make();

    registry.mount(state.connectionAtom);
    registry.mount(state.pairWithCodeAtom);
    registry.mount(state.disconnectAtom);

    const connection = AtomRegistry.getResult(registry, state.connectionAtom, {
      suspendOnWaiting: true,
    });

    const pair = (link: string) => {
      registry.set(state.pairWithCodeAtom, link);

      return Effect.exit(
        AtomRegistry.getResult(registry, state.pairWithCodeAtom, { suspendOnWaiting: true }),
      );
    };

    const disconnect = Effect.gen(function* () {
      registry.set(state.disconnectAtom, undefined);
      yield* AtomRegistry.getResult(registry, state.disconnectAtom, { suspendOnWaiting: true });
    });

    const lastPairing = Effect.sync(() => registry.get(state.pairWithCodeAtom));

    return { saved, connection, pair, disconnect, lastPairing };
  });

describe("connection state", () => {
  it.effect("connects once the mailbox accepts the pairing code", () =>
    Effect.gen(function* () {
      const { saved, connection, pair } = yield* mountState("good");

      assert.isTrue(Option.isNone(yield* connection));
      assert.isTrue(Exit.isSuccess(yield* pair(LINK)));

      const connected = yield* connection;
      assert.strictEqual(Option.getOrThrow(connected).server, "https://mailbox.example.dev");
      assert.isTrue(Option.isSome(yield* Ref.get(saved)));
    }),
  );

  it.effect("never saves a key the mailbox rejects", () =>
    Effect.gen(function* () {
      const { saved, connection, pair } = yield* mountState("rotated");

      const exit = yield* pair(LINK);

      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(
        Exit.findErrorOption(exit).pipe(Option.map((error) => error._tag)),
        Option.some("MailboxError"),
      );
      assert.isTrue(Option.isNone(yield* Ref.get(saved)));
      assert.isTrue(Option.isNone(yield* connection));
    }),
  );

  it.effect("calls a code it cannot decode unreadable without asking the mailbox", () =>
    Effect.gen(function* () {
      const { pair } = yield* mountState("good");

      const exit = yield* pair("https://example.com/menu");

      assert.deepStrictEqual(
        Exit.findErrorOption(exit).pipe(Option.map((error) => error._tag)),
        Option.some("PairingCodeUnreadable"),
      );
    }),
  );

  it.effect("disconnecting forgets the last pairing attempt", () =>
    Effect.gen(function* () {
      const { connection, pair, disconnect, lastPairing } = yield* mountState("good");

      yield* pair("https://example.com/menu");
      yield* pair(LINK);
      yield* disconnect;

      assert.isTrue(Option.isNone(yield* connection));
      assert.isTrue(AsyncResult.isInitial(yield* lastPairing));
    }),
  );
});
