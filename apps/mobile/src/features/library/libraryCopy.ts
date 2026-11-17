import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import type { MailboxErrorReason } from "../../lib/mailboxClient";
import { relativeTime } from "../../lib/relativeTime";
import { BookStatus, type Book } from "../sending/book";

export const UNSUPPORTED_FILE = "Kindle Drop sends EPUB and PDF files.";

export const FILE_UNREADABLE = "Couldn't open this file. Try sharing it again.";

const CONVERT_FAILED = "Couldn't convert this book. Try another copy of the file.";

const UPLOAD_FAILED: Readonly<Record<MailboxErrorReason, string>> = {
  unreachable: "Couldn't upload. Kindle Drop retries when you're back online.",
  unexpected: "Couldn't upload. Try again in a few minutes.",
  unauthorized: "This pairing code no longer works. Create a new one on your computer.",
};

export const CANCEL_FAILED: Readonly<Record<MailboxErrorReason, string>> = {
  unreachable: "Couldn't cancel sending. Check your connection and try again.",
  unexpected: "Couldn't cancel sending. Try again in a few minutes.",
  unauthorized: "This pairing code no longer works. Create a new one on your computer.",
};

export const FORMAT_LABEL = { epub: "EPUB", pdf: "PDF" } as const;

/** What went wrong, in the catalog's words, for a failed book. */
export const failureOf = (status: BookStatus) =>
  BookStatus.matchOrElse(
    status,
    {
      ConvertFailed: () => Option.some(CONVERT_FAILED),
      UploadFailed: ({ reason }) => Option.some(UPLOAD_FAILED[reason]),
    },
    () => Option.none<string>(),
  );

export type StatusTone = "default" | "muted" | "danger";

/** The line under a book's title in the Library. */
export const statusLine = (
  status: BookStatus,
  progress: Option.Option<number>,
  now: DateTime.Utc,
) =>
  BookStatus.match<{ readonly text: string; readonly tone: StatusTone }>(status, {
    Converting: () => ({ text: "Converting", tone: "default" }),
    Ready: () => ({ text: "Converted", tone: "default" }),
    Uploading: () => ({
      text: `Uploading · ${Math.round(Option.getOrElse(progress, () => 0) * 100)}%`,
      tone: "default",
    }),
    Waiting: () => ({ text: "Waiting for Kindle", tone: "default" }),
    OnKindle: ({ arrivedAt }) => ({
      text: `On Kindle · ${relativeTime(arrivedAt, now)}`,
      tone: "muted",
    }),
    ConvertFailed: () => ({ text: "Couldn't convert · Tap for details", tone: "danger" }),
    UploadFailed: () => ({ text: "Couldn't upload · Tap for details", tone: "danger" }),
    Canceled: ({ at }) => ({ text: `Sending canceled · ${relativeTime(at, now)}`, tone: "muted" }),
  });

const isSending = (book: Book) =>
  BookStatus.matchOrElse(
    book.status,
    { Converting: ({ confirmed }) => confirmed, Uploading: () => true, Waiting: () => true },
    () => false,
  );

const isRecent = BookStatus.isAnyOf(["OnKindle", "ConvertFailed", "UploadFailed", "Canceled"]);

/** Newest first. Books a share sheet has not sent yet appear in neither. */
export const librarySections = (books: ReadonlyArray<Book>) => {
  const newestFirst = [...books].sort(
    (a, b) => DateTime.toEpochMillis(b.addedAt) - DateTime.toEpochMillis(a.addedAt),
  );

  return {
    sending: newestFirst.filter(isSending),
    recent: newestFirst.filter((book) => isRecent(book.status)),
  };
};

const QUIET_AFTER = Duration.days(1);

const checkedInWhen = (at: DateTime.Utc, now: DateTime.Utc) => {
  const when = relativeTime(at, now);

  if (when === "Just now" || when === "Yesterday") return when.toLowerCase();

  return /^\d+ [A-Z]/.test(when) ? `on ${when}` : when;
};

/** The Library's status chip. The dot turns amber once the Kindle has been quiet for a day. */
export const checkInChip = (checkedInAt: Option.Option<DateTime.Utc>, now: DateTime.Utc) =>
  Option.match(checkedInAt, {
    onNone: () => ({ label: "Kindle hasn't checked in yet", dot: "caution" as const }),
    onSome: (at) => ({
      label: `Kindle checked in ${checkedInWhen(at, now)}`,
      dot: Duration.isGreaterThan(DateTime.distance(at, now), QUIET_AFTER)
        ? ("caution" as const)
        : ("positive" as const),
    }),
  });

/** Shown under the chip while books wait on a Kindle that has been quiet for days. */
export const quietNotice = (checkedInAt: Option.Option<DateTime.Utc>, now: DateTime.Utc) =>
  Option.flatMap(checkedInAt, (at) => {
    const days = Math.floor(Duration.toDays(DateTime.distance(at, now)));

    return days < 2
      ? Option.none()
      : Option.some(`Kindle hasn't checked in for ${days} days. Wake it to receive books.`);
  });
