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

const isRecent = (book: Book) =>
  BookStatus.matchOrElse(
    book.status,
    {
      OnKindle: () => true,
      ConvertFailed: ({ confirmed }) => confirmed,
      UploadFailed: () => true,
      Canceled: () => true,
    },
    () => false,
  );

/** Newest first. Books a share sheet has not sent yet appear in neither. */
export const librarySections = (books: ReadonlyArray<Book>) => {
  const newestFirst = [...books].sort(
    (a, b) => DateTime.toEpochMillis(b.addedAt) - DateTime.toEpochMillis(a.addedAt),
  );

  return {
    sending: newestFirst.filter(isSending),
    recent: newestFirst.filter(isRecent),
  };
};

const QUIET_AFTER = Duration.days(1);

const checkedInWhen = (at: DateTime.Utc, now: DateTime.Utc) => {
  const when = relativeTime(at, now);

  if (when === "Just now" || when === "Yesterday") return when.toLowerCase();

  return /^\d+ [A-Z]/.test(when) ? `on ${when}` : when;
};

export const CHECK_FAILED = "Couldn't check on your Kindle";

/** What the Library knows about the Kindle when it draws the status chip. */
export interface KindleCheck {
  /** The last answer the mailbox gave, kept while a newer check fails. */
  readonly last: Option.Option<{ readonly checkedInAt: Option.Option<DateTime.Utc> }>;
  /** Whether the latest check failed. */
  readonly failed: boolean;
  /** Whether any book is waiting for the Kindle. */
  readonly waiting: boolean;
}

const quietFor = (at: DateTime.Utc, now: DateTime.Utc) => {
  const days = Math.floor(Duration.toDays(DateTime.distance(at, now)));

  return days < 2
    ? Option.none()
    : Option.some(`Kindle hasn't checked in for ${days} days. Wake it to receive books.`);
};

/**
 * The Library's status chip. The dot is green after a recent check-in and amber once the Kindle has
 * been quiet for a day. When the latest check fails, the chip keeps the last answer without a dot,
 * since it no longer vouches for it, and `problem` says why. Nothing shows while the first check runs.
 */
export const kindleChip = (check: KindleCheck, now: DateTime.Utc) =>
  Option.map(check.last, ({ checkedInAt }) => {
    const label = Option.match(checkedInAt, {
      onNone: () => "Kindle hasn't checked in yet",
      onSome: (at) => `Kindle checked in ${checkedInWhen(at, now)}`,
    });

    const quiet = Option.match(checkedInAt, {
      onNone: () => true,
      onSome: (at) => Duration.isGreaterThan(DateTime.distance(at, now), QUIET_AFTER),
    });

    return check.failed
      ? { label, dot: undefined, problem: Option.some(CHECK_FAILED), quietNotice: Option.none() }
      : {
          label,
          dot: quiet ? ("caution" as const) : ("positive" as const),
          problem: Option.none(),
          quietNotice: check.waiting
            ? Option.flatMap(checkedInAt, (at) => quietFor(at, now))
            : Option.none(),
        };
  }).pipe(
    Option.orElse(() =>
      check.failed
        ? Option.some({
            label: CHECK_FAILED,
            dot: undefined,
            problem: Option.none<string>(),
            quietNotice: Option.none<string>(),
          })
        : Option.none(),
    ),
  );
