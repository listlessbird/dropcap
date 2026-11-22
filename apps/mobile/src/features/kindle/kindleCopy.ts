import {
  Command,
  type Book,
  type BookPath,
  type Device,
  type QueuedCommand,
} from "@dropcap/worker/Api";
import type * as Cause from "effect/Cause";
import type * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import type { MailboxError, MailboxErrorReason } from "../../lib/mailboxClient";
import type { ConnectionStoreError } from "../../persistence/connection-store";
import type { MobileDatabaseError } from "../../persistence/mobile-database";
import { gigabytes } from "../../lib/units";
import { checkedInWhen } from "../library/libraryCopy";

const pending = (commands: ReadonlyArray<QueuedCommand>) =>
  commands.filter(({ outcome }) => Option.isNone(outcome));

/** A book on the Kindle, and the delete waiting for its next wake, if the app queued one. */
export interface LibraryEntry {
  readonly book: Book;
  readonly deleting: Option.Option<QueuedCommand>;
}

export const libraryEntries = (
  books: ReadonlyArray<Book>,
  commands: ReadonlyArray<QueuedCommand>,
): ReadonlyArray<LibraryEntry> => {
  const deletes = pending(commands);

  return books
    .map((book) => ({
      book,
      deleting: Option.fromNullishOr(
        deletes.find(
          ({ command }) => Command.guards.DeleteBook(command) && command.path === book.path,
        ),
      ),
    }))
    .sort((a, b) => a.book.title.localeCompare(b.book.title));
};

export const rescanPending = (commands: ReadonlyArray<QueuedCommand>) =>
  pending(commands).some(({ command }) => Command.guards.Rescan(command));

// A deleted book is gone from the library, so its failure names it from the file instead.
const fileTitle = (path: BookPath) => {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");

  return dot > 0 ? file.slice(0, dot) : file;
};

const failureText = (command: Command) =>
  Command.match(command, {
    DeleteBook: ({ path }) => `Couldn't delete ${fileTitle(path)}`,
    Rescan: () => "Couldn't rescan",
  });

/** Commands the Kindle could not run, newest first. The Kindle's own error text stays out of the UI. */
export const failures = (commands: ReadonlyArray<QueuedCommand>) =>
  commands
    .flatMap(({ id, command, outcome }) =>
      Option.isSome(outcome) && outcome.value.outcome === "failed"
        ? [{ id, command, text: failureText(command) }]
        : [],
    )
    .reverse();

/** Entries whose title contains `query`, ignoring case. A blank query matches everything. */
export const searchEntries = (entries: ReadonlyArray<LibraryEntry>, query: string) => {
  const needle = query.trim().toLocaleLowerCase();

  return needle === ""
    ? entries
    : entries.filter(({ book }) => book.title.toLocaleLowerCase().includes(needle));
};

/** The device tiles and the line under them. A value the Kindle could not read is left out. */
export const deviceSummary = (device: Device, now: DateTime.Utc) => ({
  checkedIn: [`Kindle checked in ${checkedInWhen(device.reportedAt, now)}`, device.firmware]
    .filter(Boolean)
    .join(" · "),
  battery: Option.fromNullishOr(device.battery).pipe(
    Option.map((percent) => ({ value: `${percent}%`, charging: device.charging === true })),
  ),
  free: Option.fromNullishOr(device.freeKb).pipe(
    Option.map((kb) => ({
      value: gigabytes(kb * 1024),
      used: Option.fromNullishOr(device.totalKb).pipe(
        Option.filter((total) => total > 0),
        Option.map((total) => 1 - kb / total),
      ),
    })),
  ),
});

const COMMAND_FAILED: Readonly<Record<MailboxErrorReason, string>> = {
  unauthorized: "This pairing code no longer works. Create a new one on your computer.",
  unreachable: "Couldn't save this change. Check your connection and try again.",
  unexpected: "Couldn't save this change. Try again in a few minutes.",
};

/** Why queueing, retrying or cancelling a command failed. Nothing while unpaired: the app is leaving. */
export const commandError = (
  result: AsyncResult.AsyncResult<
    unknown,
    MailboxError | Cause.NoSuchElementError | ConnectionStoreError | MobileDatabaseError
  >,
) =>
  AsyncResult.matchWithError(result, {
    onInitial: () => undefined,
    onSuccess: () => undefined,
    onDefect: () => COMMAND_FAILED.unexpected,
    onError: Match.valueTags({
      MailboxError: (error) => COMMAND_FAILED[error.reason],
      NoSuchElementError: () => undefined,
      ConnectionStoreError: () => COMMAND_FAILED.unexpected,
      MobileDatabaseError: () => COMMAND_FAILED.unexpected,
    }),
  });
