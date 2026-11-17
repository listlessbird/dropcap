import {
  ItemKey,
  ItemName,
  nameOfKey,
  uploadedAtOfKey,
  type MailboxStatus,
} from "@kindle-drop/worker/Api";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { MailboxErrorReason } from "../../lib/mailboxClient";

export const BookId = Schema.String.pipe(Schema.brand("BookId"));

export type BookId = typeof BookId.Type;

export const BookFormat = Schema.Literals(["epub", "pdf"]);

export type BookFormat = typeof BookFormat.Type;

/** The file as the user shared it. */
export const Source = Schema.Struct({
  name: Schema.String,
  format: BookFormat,
  bytes: Schema.Number,
});

export type Source = typeof Source.Type;

/** What the Kindle receives. A PDF is its own book, with no thumbnail and no conversion time. */
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
  ConvertFailed: { confirmed: Schema.Boolean },
  UploadFailed: {
    converted: Converted,
    uploaded: Schema.Array(ItemKey),
    reason: MailboxErrorReason,
  },
  Canceled: { converted: Converted, at: Schema.DateTimeUtcFromMillis },
});

export type BookStatus = typeof BookStatus.Type;

export const Book = Schema.Struct({
  id: BookId,
  addedAt: Schema.DateTimeUtcFromMillis,
  source: Source,
  status: BookStatus,
});

export type Book = typeof Book.Type;

export type BookEvent = Data.TaggedEnum<{
  Converted: { readonly converted: Converted };
  ConvertFailed: {};
  Confirmed: {};
  ItemUploaded: { readonly key: ItemKey };
  UploadFailed: { readonly reason: MailboxErrorReason };
  MailboxChecked: { readonly status: MailboxStatus };
  SendingCanceled: { readonly at: DateTime.Utc };
  Retried: {};
}>;

export const BookEvent = Data.taggedEnum<BookEvent>();

const { Converting, Ready, Uploading, Waiting, OnKindle, ConvertFailed, UploadFailed, Canceled } =
  BookStatus.cases;

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
const arrivedAt = (items: Arr.NonEmptyReadonlyArray<ItemKey>, status: MailboxStatus) =>
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
    ConvertFailed: () =>
      BookStatus.matchOrElse(
        status,
        { Converting: ({ confirmed }) => ConvertFailed.make({ confirmed }) },
        unchanged,
      ),
    Confirmed: () =>
      BookStatus.matchOrElse(
        status,
        {
          Converting: () => Converting.make({ confirmed: true }),
          Ready: ({ converted }) => uploading(converted, []),
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
          UploadFailed: ({ converted, uploaded }) => uploading(converted, uploaded),
        },
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
  ["application/pdf", "pdf"],
]);

/** EPUB or PDF by MIME type, or by extension for senders that only say `application/octet-stream`. */
export const formatOf = (name: string, mimeType: Option.Option<string>) =>
  Option.orElse(
    Option.flatMapNullishOr(mimeType, (type) => FORMAT_OF_TYPE.get(type)),
    () => decodeFormat(/\.(epub|pdf)$/i.exec(name)?.[1]?.toLowerCase()),
  );

const stem = (name: string) => name.replace(/\.(epub|pdf)$/i, "");

// What ts.sh's tab-separated listing and the Kindle's file system cannot take.
const UNSAFE_IN_NAME = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

/** The shared file's name, made safe for the mailbox. EPUBs keep the converter's names instead. */
export const pdfItemName = (sharedName: string) => {
  const safe = stem(sharedName).replace(UNSAFE_IN_NAME, "_").trim().slice(0, 120);

  return ItemName.make(`${safe === "" ? "untitled" : safe}.pdf`);
};

/** A PDF goes to the Kindle as shared. */
export const pdfConverted = (source: Source, name: ItemName): Converted => ({
  title: stem(source.name),
  author: "",
  book: name,
  bookBytes: source.bytes,
  thumbnail: Option.none(),
  convertedIn: Option.none(),
});

/** The title and author to show, from the book's metadata once converted and its file name before. */
export const labelOf = (book: Book) =>
  Option.match(convertedOf(book.status), {
    onNone: () => ({ title: stem(book.source.name), author: "" }),
    onSome: ({ title, author }) => ({ title, author }),
  });
