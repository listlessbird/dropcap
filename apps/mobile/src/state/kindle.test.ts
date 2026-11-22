import { assert, describe, it } from "@effect/vitest";
import { Command, commandId, type QueuedCommand } from "@kindle-drop/worker/Api";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { Atom, AtomRegistry } from "effect/reactivity";

import { Connection } from "../lib/connection";
import { MailboxClient } from "../lib/mailboxClient";
import { ConnectionStore } from "../persistence/connection-store";
import { createKindleState } from "./kindle";

const paired = Schema.decodeUnknownSync(Connection)({
  server: "https://mailbox.example.dev",
  key: "good",
});

// A mailbox that keeps queued commands in memory, and a status atom like booksState's.
const mountState = Effect.gen(function* () {
  const queued = yield* Ref.make<ReadonlyArray<QueuedCommand>>([]);
  const next = yield* Ref.make(0);

  const layer = Layer.mergeAll(
    Layer.succeed(
      ConnectionStore,
      ConnectionStore.of({
        load: Effect.succeedSome(paired),
        save: () => Effect.die("unused"),
        clear: Effect.die("unused"),
      }),
    ),
    Layer.succeed(
      MailboxClient,
      MailboxClient.of({
        status: () =>
          Effect.map(Ref.get(queued), (commands) => ({
            checkedInAt: Option.none(),
            waiting: [],
            device: Option.none(),
            commands,
          })),
        queue: (_, command: Command) =>
          Effect.gen(function* () {
            const id = commandId(yield* Ref.getAndUpdate(next, (n) => n + 1), 0);

            yield* Ref.update(queued, (all) => [
              ...all,
              { id, queuedAt: DateTime.makeUnsafe(0), command, outcome: Option.none() },
            ]);

            return id;
          }),
        dismiss: (_, id) => Ref.update(queued, (all) => all.filter((command) => command.id !== id)),
        cancel: () => Effect.die("unused"),
        upload: () => Effect.die("unused"),
      }),
    ),
  );

  const runtime = Atom.runtime(layer);
  const statusAtom = runtime.atom(MailboxClient.use((mailbox) => mailbox.status(paired)));

  const state = createKindleState(runtime, statusAtom);
  const registry = AtomRegistry.make();

  registry.mount(statusAtom);
  registry.mount(state.queueAtom);

  const commands = Effect.map(
    AtomRegistry.getResult(registry, statusAtom, { suspendOnWaiting: true }),
    (status) => status.commands,
  );

  return { state, registry, commands };
});

describe("kindle state", () => {
  it.effect("a queued command shows as pending at once, and is gone once cancelled", () =>
    Effect.gen(function* () {
      const { state, registry, commands } = yield* mountState;

      assert.deepStrictEqual(yield* commands, []);

      registry.set(state.queueAtom, Command.cases.Rescan.make({}));
      yield* AtomRegistry.getResult(registry, state.queueAtom, { suspendOnWaiting: true });

      const [rescan] = yield* commands;
      assert.isDefined(rescan);
      assert.strictEqual(rescan.command._tag, "Rescan");
      assert.isTrue(Option.isNone(rescan.outcome));

      const dismissAtom = state.dismissAtom(rescan.id);
      registry.mount(dismissAtom);
      registry.set(dismissAtom, undefined);
      yield* AtomRegistry.getResult(registry, dismissAtom, { suspendOnWaiting: true });

      assert.deepStrictEqual(yield* commands, []);
    }),
  );

  it.effect("trying a failed command again queues it anew and clears the failure", () =>
    Effect.gen(function* () {
      const { state, registry, commands } = yield* mountState;
      const rescan = Command.cases.Rescan.make({});

      registry.set(state.queueAtom, rescan);
      yield* AtomRegistry.getResult(registry, state.queueAtom, { suspendOnWaiting: true });
      const [failed] = yield* commands;
      assert.isDefined(failed);

      const retryAtom = state.retryAtom(failed.id);
      registry.mount(retryAtom);
      registry.set(retryAtom, rescan);
      yield* AtomRegistry.getResult(registry, retryAtom, { suspendOnWaiting: true });

      const after = yield* commands;
      assert.strictEqual(after.length, 1);
      assert.notStrictEqual(after[0]?.id, failed.id);
      assert.strictEqual(after[0]?.command._tag, "Rescan");
    }),
  );
});
