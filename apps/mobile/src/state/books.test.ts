import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { BookId } from "../features/sending/book";
import { Sender } from "../features/sending/sender";
import { MailboxError } from "../lib/mailboxClient";
import { createBooksState } from "./books";

const offline = new MailboxError({ reason: "unreachable", cause: null });

const sender = Layer.succeed(
  Sender,
  Sender.of({
    books: Stream.make([]),
    progress: Stream.make(new Map()),
    add: () => Effect.die("unused"),
    confirm: () => Effect.void,
    discard: () => Effect.void,
    cancelSending: (id) => (id === "a" ? Effect.fail(offline) : Effect.void),
    retry: () => Effect.void,
    clear: () => Effect.void,
    refresh: Effect.die("unused"),
  }),
);

describe("books state", () => {
  it.effect("keeps one book's Cancel sending error off another book's screen", () =>
    Effect.gen(function* () {
      const state = createBooksState(Atom.runtime(sender));
      const registry = AtomRegistry.make();
      const a = state.cancelSendingAtom(BookId.make("a"));
      const b = state.cancelSendingAtom(BookId.make("b"));

      registry.mount(a);
      registry.mount(b);
      registry.set(a, undefined);

      const exit = yield* Effect.exit(
        AtomRegistry.getResult(registry, a, { suspendOnWaiting: true }),
      );

      assert.isTrue(Exit.isFailure(exit));
      assert.isTrue(AsyncResult.isInitial(registry.get(b)));
    }),
  );
});
