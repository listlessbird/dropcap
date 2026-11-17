import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";

import type { BookId } from "../features/sending/book";
import { Sender } from "../features/sending/sender";
import * as Runtime from "../lib/runtime";

/** Every book and what can be done with it. Work keeps running in the Sender, not in these atoms. */
export function createBooksState<E>(runtime: Atom.AtomRuntime<Sender, E>) {
  const booksAtom = runtime
    .atom(Stream.unwrap(Sender.use((sender) => Effect.succeed(sender.books))))
    .pipe(Atom.keepAlive, Atom.withLabel("books"));

  const progressAtom = runtime
    .atom(Stream.unwrap(Sender.use((sender) => Effect.succeed(sender.progress))))
    .pipe(Atom.keepAlive, Atom.withLabel("books:progress"));

  const bookAtom = Atom.family((id: BookId) =>
    Atom.make((get) =>
      AsyncResult.map(get(booksAtom), (books) =>
        Option.fromNullishOr(books.find((book) => book.id === id)),
      ),
    ).pipe(Atom.withLabel(`book:${id}`)),
  );

  /** The mailbox's view of the Kindle, and when this phone asked. Refreshing it also follows books. */
  const kindleStatusAtom = runtime
    .atom(
      Effect.gen(function* () {
        const status = yield* Sender.use((sender) => sender.refresh);

        return { ...status, askedAt: yield* DateTime.now };
      }),
    )
    .pipe(Atom.withLabel("books:kindle-status"));

  const action = (
    label: string,
    run: (sender: Sender["Service"], id: BookId) => Effect.Effect<void>,
  ) =>
    runtime
      .fn((id: BookId) => Sender.use((sender) => run(sender, id)), { concurrent: true })
      .pipe(Atom.keepAlive, Atom.withLabel(`books:${label}`));

  const cancelSendingAtom = runtime
    .fn((id: BookId) => Sender.use((sender) => sender.cancelSending(id)))
    .pipe(Atom.keepAlive, Atom.withLabel("books:cancel-sending"));

  return {
    booksAtom,
    progressAtom,
    bookAtom,
    kindleStatusAtom,
    confirmAtom: action("confirm", (sender, id) => sender.confirm(id)),
    discardAtom: action("discard", (sender, id) => sender.discard(id)),
    retryAtom: action("retry", (sender, id) => sender.retry(id)),
    clearAtom: action("clear", (sender, id) => sender.clear(id)),
    cancelSendingAtom,
  } as const;
}

export const booksState = createBooksState(Atom.runtime(Runtime.layer));
