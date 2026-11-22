import type { Command, CommandId } from "@kindle-drop/worker/Api";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { Connection } from "../lib/connection";
import { MailboxClient } from "../lib/mailboxClient";
import * as Runtime from "../lib/runtime";
import { ConnectionStore } from "../persistence/connection-store";
import { booksState } from "./books";

/**
 * Commands for the Kindle's next wake. Each one refreshes `statusAtom`, which carries the queue and
 * the Kindle's last report, so the screen shows the new command as pending at once.
 */
export function createKindleState<E>(
  runtime: Atom.AtomRuntime<ConnectionStore | MailboxClient, E>,
  statusAtom: Atom.Atom<unknown>,
) {
  const withConnection = Effect.fnUntraced(function* <A, Err>(
    get: Atom.FnContext,
    run: (mailbox: MailboxClient["Service"], connection: Connection) => Effect.Effect<A, Err>,
  ) {
    const connection = yield* Effect.fromOption(yield* ConnectionStore.use((store) => store.load));

    yield* MailboxClient.use((mailbox) => run(mailbox, connection));
    get.refresh(statusAtom);
  });

  const queueAtom = runtime
    .fn((command: Command, get) =>
      withConnection(get, (mailbox, connection) => mailbox.queue(connection, command)),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("kindle:queue"));

  // One per command, so cancelling one delete never shows a spinner on another book.
  const dismissAtom = Atom.family((id: CommandId) =>
    runtime
      .fn((_: void, get) =>
        withConnection(get, (mailbox, connection) => mailbox.dismiss(connection, id)),
      )
      .pipe(Atom.keepAlive, Atom.withLabel(`kindle:dismiss:${id}`)),
  );

  // Queues the failed command again, then clears the failure, so its notice goes away.
  const retryAtom = Atom.family((id: CommandId) =>
    runtime
      .fn((command: Command, get) =>
        withConnection(get, (mailbox, connection) =>
          mailbox.queue(connection, command).pipe(Effect.andThen(mailbox.dismiss(connection, id))),
        ),
      )
      .pipe(Atom.keepAlive, Atom.withLabel(`kindle:retry:${id}`)),
  );

  return { queueAtom, dismissAtom, retryAtom } as const;
}

export const kindleState = createKindleState(
  Atom.runtime(Runtime.layer),
  booksState.kindleStatusAtom,
);
