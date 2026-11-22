import {
  ItemKey,
  ItemName,
  nameOfKey,
  uploadedAtOfKey,
  type MailboxStatus,
} from "@dropcap/worker/Api";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MailboxErrorReason } from "../../lib/mailboxClient";

export const BookId = Schema.String.pipe(Schema.brand("BookId"));

export type BookId = typeof BookId.Type;

/** The formats of files the app sends. */
export const BookFormat = Schema.Literals(["epub", "azw3", "pdf", "txt"]);

export type BookFormat = typeof BookFormat.Type;

/** The file as the user shared it. */
export const FileSource = Schema.Struct({
  name: Schema.String,
  format: BookFormat,
  bytes: Schema.Number,
});

export type FileSource = typeof FileSource.Type;

/** A link to a web article, fetched when it converts. `name` is the page title shared with it. */
export const ArticleSource = Schema.Struct({
  name: Schema.String,
  format: Schema.Literal("article"),
  url: Schema.String,
});

/** What the user shared: a file, or a link to an article. */
export const Source = Schema.Union([FileSource, ArticleSource]);

export type Source = typeof Source.Type;

/** An EPUB and an article are converted. The Kindle reads the other formats as shared. */
export const isConvertible = (format: Source["format"]) =>
  format === "epub" || format === "article";

/**
 * What the Kindle receives. A book sent as shared has no conversion time, and only an AZW3 that
 * carries a cover has a thumbnail.
 */
export const Converted = Schema.Struct({
  title: Schema.String,
  author: Schema.String,
  book: ItemName,
  bookBytes: Schema.Number,
  thumbnail: Schema.OptionFromNullOr(ItemName),
  convertedIn: Schema.OptionFromNullOr(Schema.DurationFromMillis),
});

export type Converted = typeof Converted.Type;

const Items = Schema.NonEmptyArray(ItemKey);

/**
 * Why a conversion stopped: the article's page could not be reached, which retries once the phone is
 * online, or the book or page could not be converted.
 */
export const ConvertFailure = Schema.Literals(["unreachable", "invalid"]);

export type ConvertFailure = typeof ConvertFailure.Type;

/** Why an upload stopped: the mailbox's reasons, or the book file is gone from this phone. */
export const UploadFailure = Schema.Literals([...MailboxErrorReason.literals, "missing"]);

/**
 * Where a book is between the share and the Kindle. `uploaded` and `items` are mailbox keys in
 * upload order, which is also the order the Kindle installs them.
 */
export const BookStatus = Schema.TaggedUnion({
  /** Unconfirmed while a share sheet shows it. Confirmed books upload as soon as they convert. */
  Converting: { confirmed: Schema.Boolean },
  Ready: { converted: Converted },
  Uploading: { converted: Converted, uploaded: Schema.Array(ItemKey) },
  Waiting: { converted: Converted, items: Items },
  OnKindle: { converted: Converted, items: Items, arrivedAt: Schema.DateTimeUtcFromMillis },
  /** Keeps `confirmed`, so a sheet's Cancel discards only a book the user never sent. */
  ConvertFailed: {
    confirmed: Schema.Boolean,
    // Failures stored before articles had no reason, and were all conversions.
    reason: ConvertFailure.pipe(Schema.withDecodingDefaultKey(Effect.succeed("invalid" as const))),
  },
  UploadFailed: {
    converted: Converted,
    uploaded: Schema.Array(ItemKey),
    reason: UploadFailure,
  },
  Canceled: { converted: Converted, at: Schema.DateTimeUtcFromMillis },
  /** Cleared from Recent, with items a failed upload left in the mailbox still to remove. */
  Clearing: { items: Schema.Array(ItemKey) },
});

export type BookStatus = typeof BookStatus.Type;

export type UploadFailure = typeof UploadFailure.Type;

export const Book = Schema.Struct({
  id: BookId,
  addedAt: Schema.DateTimeUtcFromMillis,
  source: Source,
  status: BookStatus,
});

export type Book = typeof Book.Type;

/** The part of the mailbox's status that follows books. */
export type MailboxCheck = Pick<MailboxStatus, "checkedInAt" | "waiting">;

export type BookEvent = Data.TaggedEnum<{
  Converted: { readonly converted: Converted };
  ConvertFailed: { readonly reason: ConvertFailure };
  Confirmed: {};
  ItemUploaded: { readonly key: ItemKey };
  UploadFailed: { readonly reason: UploadFailure };
  MailboxChecked: { readonly status: MailboxCheck };
  SendingCanceled: { readonly at: DateTime.Utc };
  Retried: {};
  Cleared: {};
}>;

export const BookEvent = Data.taggedEnum<BookEvent>();

const {
  Converting,
  Ready,
  Uploading,
  Waiting,
  OnKindle,
  ConvertFailed,
  UploadFailed,
  Canceled,
  Clearing,
} = BookStatus.cases;

/** The thumbnail goes first: the Kindle installs a cover before it indexes the book. */
export const itemNames = (converted: Converted): ReadonlyArray<ItemName> => [
  ...Option.toArray(converted.thumbnail),
  converted.book,
];

export const uploadedAt = (items: Arr.NonEmptyReadonlyArray<ItemKey>) =>
  DateTime.makeUnsafe(uploadedAtOfKey(Arr.lastNonEmpty(items)));

const uploading = (converted: Converted, uploaded: ReadonlyArray<ItemKey>): BookStatus =>
  Arr.isReadonlyArrayNonEmpty(uploaded) && uploaded.length === itemNames(converted).length
    ? Waiting.make({ converted, items: uploaded })
    : Uploading.make({ converted, uploaded });

/**
 * When the Kindle took a book: in a check-in after its last item arrived, with none of its items
 * left. The mailbox's lifecycle also removes items, after 30 days, but never with a later check-in.
 * Both times come from the Worker's side, so the phone's clock cannot skew the comparison.
 */
const arrivedAt = (items: Arr.NonEmptyReadonlyArray<ItemKey>, status: MailboxCheck) =>
  Option.filter(
    status.checkedInAt,
    (at) =>
      DateTime.isGreaterThan(at, uploadedAt(items)) &&
      items.every((key) => !status.waiting.includes(key)),
  );

// Events down the side, statuses across. A status an event does not list stays as it is.
const next = (status: BookStatus, event: BookEvent): BookStatus => {
  const unchanged = () => status;

  return BookEvent.$match(event, {
    Converted: ({ converted }) =>
      BookStatus.matchOrElse(
        status,
        {
          Converting: ({ confirmed }) =>
            confirmed ? uploading(converted, []) : Ready.make({ converted }),
        },
        unchanged,
      ),
    ConvertFailed: ({ reason }) =>
      BookStatus.matchOrElse(
        status,
        { Converting: ({ confirmed }) => ConvertFailed.make({ confirmed, reason }) },
        unchanged,
      ),
    // A sheet can send an article its offline phone could not fetch yet. It retries once online.
    Confirmed: () =>
      BookStatus.matchOrElse(
        status,
        {
          Converting: () => Converting.make({ confirmed: true }),
          Ready: ({ converted }) => uploading(converted, []),
          ConvertFailed: ({ reason }) => ConvertFailed.make({ confirmed: true, reason }),
        },
        unchanged,
      ),
    ItemUploaded: ({ key }) =>
      BookStatus.matchOrElse(
        status,
        { Uploading: ({ converted, uploaded }) => uploading(converted, [...uploaded, key]) },
        unchanged,
      ),
    UploadFailed: ({ reason }) =>
      BookStatus.matchOrElse(
        status,
        {
          Uploading: ({ converted, uploaded }) =>
            UploadFailed.make({ converted, uploaded, reason }),
        },
        unchanged,
      ),
    MailboxChecked: (checked) =>
      BookStatus.matchOrElse(
        status,
        {
          Waiting: ({ converted, items }) =>
            Option.match(arrivedAt(items, checked.status), {
              onNone: unchanged,
              onSome: (at) => OnKindle.make({ converted, items, arrivedAt: at }),
            }),
        },
        unchanged,
      ),
    SendingCanceled: ({ at }) =>
      BookStatus.matchOrElse(
        status,
        { Waiting: ({ converted }) => Canceled.make({ converted, at }) },
        unchanged,
      ),
    Retried: () =>
      BookStatus.matchOrElse(
        status,
        {
          ConvertFailed: () => Converting.make({ confirmed: true }),
          UploadFailed: ({ converted, uploaded, reason }) =>
            reason === "missing" ? status : uploading(converted, uploaded),
        },
        unchanged,
      ),
    Cleared: () =>
      BookStatus.matchOrElse(
        status,
        { UploadFailed: ({ uploaded }) => Clearing.make({ items: uploaded }) },
        unchanged,
      ),
  });
};

/** Applies an event, returning the same book when the event does not apply to its status. */
export const transition = (book: Book, event: BookEvent): Book => {
  const status = next(book.status, event);

  return status === book.status ? book : { ...book, status };
};

/**
 * An item a previous attempt already put in the mailbox, which the record never heard about because
 * the app stopped first. It has the same name, follows `uploaded` so the upload order holds, and no
 * other book claims it. Uploading again instead would send the Kindle a second copy.
 */
export const leftInMailbox = (
  name: ItemName,
  uploaded: ReadonlyArray<ItemKey>,
  waiting: ReadonlyArray<ItemKey>,
  claimed: ReadonlySet<ItemKey>,
) => {
  const after = Arr.last(uploaded);

  return Arr.findFirst(
    waiting,
    (key) =>
      nameOfKey(key) === name &&
      !claimed.has(key) &&
      Option.match(after, { onNone: () => true, onSome: (previous) => key > previous }),
  );
};

/** The mailbox keys a book holds, so no other book adopts them. */
export const claimedItems = (status: BookStatus): ReadonlyArray<ItemKey> =>
  BookStatus.matchOrElse(
    status,
    {
      Uploading: ({ uploaded }) => uploaded,
      UploadFailed: ({ uploaded }) => uploaded,
      Clearing: ({ items }) => items,
      Waiting: ({ items }) => items,
      OnKindle: ({ items }) => items,
    },
    () => [],
  );

/** Books a share sheet is still showing, which the user has not sent. */
export const isUnconfirmed = (status: BookStatus) =>
  BookStatus.matchOrElse(
    status,
    {
      Converting: ({ confirmed }) => !confirmed,
      Ready: () => true,
      ConvertFailed: ({ confirmed }) => !confirmed,
    },
    () => false,
  );

/** Failures that Try again can fix. A book whose file is gone has to be shared again. */
export const canRetry = (status: BookStatus) =>
  BookStatus.matchOrElse(
    status,
    { ConvertFailed: () => true, UploadFailed: ({ reason }) => reason !== "missing" },
    () => false,
  );

/** A sent article whose page could not be reached, which converts again once the phone is online. */
export const waitsForConnection = (status: BookStatus) =>
  BookStatus.matchOrElse(
    status,
    { ConvertFailed: ({ reason }) => reason === "unreachable" },
    () => false,
  );

/** Books with work left on the phone: a send to convert or upload. */
export const isInFlight = (status: BookStatus) =>
  BookStatus.matchOrElse(
    status,
    { Converting: ({ confirmed }) => confirmed, Uploading: () => true },
    () => false,
  );

export const convertedOf = (status: BookStatus): Option.Option<Converted> =>
  "converted" in status ? Option.some(status.converted) : Option.none();

const decodeFormat = Schema.decodeUnknownOption(BookFormat);

const FORMAT_OF_TYPE: ReadonlyMap<string, BookFormat> = new Map([
  ["application/epub+zip", "epub"],
  ["application/vnd.amazon.mobi8-ebook", "azw3"],
  ["application/x-mobi8-ebook", "azw3"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
]);

const EXTENSION = /\.(epub|azw3|pdf|txt)$/i;

/** The format by MIME type, or by extension for senders that only say `application/octet-stream`. */
export const formatOf = (name: string, mimeType: Option.Option<string>) =>
  Option.orElse(
    Option.flatMapNullishOr(mimeType, (type) => FORMAT_OF_TYPE.get(type)),
    () => decodeFormat(EXTENSION.exec(name)?.[1]?.toLowerCase()),
  );

/** The shared file's name without a format's extension, the title until conversion finds one. */
export const stem = (name: string) => name.replace(EXTENSION, "");

// What dropcap.sh's tab-separated listing and the Kindle's file system cannot take.
const UNSAFE_IN_NAME = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

/** The shared file's name, made safe for the mailbox. EPUBs keep the converter's names instead. */
export const itemNameOf = (sharedName: string, format: BookFormat) => {
  const safe = stem(sharedName).replace(UNSAFE_IN_NAME, "_").trim().slice(0, 120);

  return ItemName.make(`${safe === "" ? "untitled" : safe}.${format}`);
};

/** A book the Kindle reads as shared, with the cover an AZW3 carries. */
export const sentAsShared = (
  source: FileSource,
  name: ItemName,
  thumbnail: Option.Option<ItemName>,
): Converted => ({
  title: stem(source.name),
  author: "",
  book: name,
  bookBytes: source.bytes,
  thumbnail,
  convertedIn: Option.none(),
});

// The scheme keeps out links an app cannot fetch. Trailing punctuation is the sentence's, not the link's.
const LINK = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'}]/i;

/** The link in shared text, as from a browser's Share, which may also carry a title or a comment. */
export const articleUrlOf = (text: string) => Option.fromNullishOr(LINK.exec(text)?.[0]);

/** The link's site, as "example.com". */
export const siteOf = (url: string) => /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url)?.[1] ?? url;

/**
 * The title and author to show, from the book's metadata once converted, and before that, the file
 * name or the article's shared title.
 */
export const labelOf = (book: Book) =>
  Option.match(convertedOf(book.status), {
    onNone: () => ({
      title: book.source.format === "article" ? book.source.name : stem(book.source.name),
      author: "",
    }),
    onSome: ({ title, author }) => ({ title, author }),
  });
