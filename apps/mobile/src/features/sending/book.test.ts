import { assert, describe, it } from "@effect/vitest";
import { ItemKey, ItemName, itemKey } from "@kindle-drop/worker/Api";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  Book,
  BookEvent,
  BookId,
  BookStatus,
  formatOf,
  isUnconfirmed,
  leftInMailbox,
  pdfItemName,
  transition,
  type Converted,
} from "./book";

const { Converting, Ready, Uploading, Waiting, OnKindle, ConvertFailed, UploadFailed, Canceled } =
  BookStatus.cases;

const converted: Converted = {
  title: "House of Chains",
  author: "Steven Erikson",
  book: ItemName.make("House of Chains - Steven Erikson.azw3"),
  bookBytes: 2_400_000,
  thumbnail: Option.some(ItemName.make("thumbnail_B0TEST_EBOK_portrait.jpg")),
  convertedIn: Option.some(Duration.seconds(5.7)),
};

const UPLOADED_AT = 1_800_000_000_000;
const thumbnailKey = itemKey(UPLOADED_AT, ItemName.make("thumbnail_B0TEST_EBOK_portrait.jpg"));
const bookKey = itemKey(UPLOADED_AT + 900, ItemName.make("House of Chains - Steven Erikson.azw3"));

const bookWith = (status: BookStatus): Book => ({
  id: BookId.make("b1"),
  addedAt: DateTime.makeUnsafe(UPLOADED_AT - 60_000),
  source: { name: "House of Chains - Steven Erikson.epub", format: "epub", bytes: 9_100_000 },
  status,
});

const run = (status: BookStatus, ...events: ReadonlyArray<BookEvent>) =>
  events.reduce(transition, bookWith(status)).status;

const checkIn = (at: number, waiting: ReadonlyArray<ItemKey>) =>
  BookEvent.MailboxChecked({
    status: { checkedInAt: Option.some(DateTime.makeUnsafe(at)), waiting },
  });

const waiting = Waiting.make({ converted, items: [thumbnailKey, bookKey] });

describe("transition", () => {
  it("waits for confirmation once converted, unless the user already sent it", () => {
    assert.deepStrictEqual(
      run(Converting.make({ confirmed: false }), BookEvent.Converted({ converted })),
      Ready.make({ converted }),
    );
    assert.deepStrictEqual(
      run(
        Converting.make({ confirmed: false }),
        BookEvent.Confirmed(),
        BookEvent.Converted({ converted }),
      ),
      Uploading.make({ converted, uploaded: [] }),
    );
    assert.deepStrictEqual(
      run(Ready.make({ converted }), BookEvent.Confirmed()),
      Uploading.make({ converted, uploaded: [] }),
    );
  });

  it("waits for the Kindle once every item is in the mailbox, thumbnail first", () => {
    const uploading = Uploading.make({ converted, uploaded: [] });

    assert.deepStrictEqual(
      run(uploading, BookEvent.ItemUploaded({ key: thumbnailKey })),
      Uploading.make({ converted, uploaded: [thumbnailKey] }),
    );
    assert.deepStrictEqual(
      run(
        uploading,
        BookEvent.ItemUploaded({ key: thumbnailKey }),
        BookEvent.ItemUploaded({ key: bookKey }),
      ),
      waiting,
    );
  });

  it("keeps what reached the mailbox when an upload fails, and retries from there", () => {
    const failed = run(
      Uploading.make({ converted, uploaded: [thumbnailKey] }),
      BookEvent.UploadFailed({ reason: "unreachable" }),
    );

    assert.deepStrictEqual(
      failed,
      UploadFailed.make({ converted, uploaded: [thumbnailKey], reason: "unreachable" }),
    );
    assert.deepStrictEqual(
      run(failed, BookEvent.Retried()),
      Uploading.make({ converted, uploaded: [thumbnailKey] }),
    );
    assert.deepStrictEqual(
      run(ConvertFailed.make({ confirmed: true }), BookEvent.Retried()),
      Converting.make({ confirmed: true }),
    );
  });

  it("remembers whether the user sent a book whose conversion failed", () => {
    const sent = run(Converting.make({ confirmed: true }), BookEvent.ConvertFailed());
    const unsent = run(Converting.make({ confirmed: false }), BookEvent.ConvertFailed());

    assert.deepStrictEqual(sent, ConvertFailed.make({ confirmed: true }));
    assert.isFalse(isUnconfirmed(sent));
    assert.isTrue(isUnconfirmed(unsent));
  });

  it("ignores events that do not apply to the current status", () => {
    const ready = bookWith(Ready.make({ converted }));

    assert.strictEqual(transition(ready, BookEvent.Converted({ converted })), ready);
    assert.strictEqual(transition(ready, BookEvent.Retried()), ready);
    assert.strictEqual(transition(ready, checkIn(UPLOADED_AT + 5_000, [])), ready);
  });

  it("cancels only a book that is waiting for the Kindle", () => {
    const at = DateTime.makeUnsafe(UPLOADED_AT + 10_000);

    assert.deepStrictEqual(
      run(waiting, BookEvent.SendingCanceled({ at })),
      Canceled.make({ converted, at }),
    );
    assert.deepStrictEqual(
      run(Ready.make({ converted }), BookEvent.SendingCanceled({ at })),
      Ready.make({ converted }),
    );
  });
});

describe("delivery", () => {
  it("is on the Kindle when its items left in a check-in after the upload", () => {
    assert.deepStrictEqual(
      run(waiting, checkIn(UPLOADED_AT + 60_000, [])),
      OnKindle.make({
        converted,
        items: [thumbnailKey, bookKey],
        arrivedAt: DateTime.makeUnsafe(UPLOADED_AT + 60_000),
      }),
    );
  });

  it("is still waiting while any item is in the mailbox", () => {
    assert.deepStrictEqual(run(waiting, checkIn(UPLOADED_AT + 60_000, [bookKey])), waiting);
  });

  it("does not mistake items the mailbox expired for delivery", () => {
    assert.deepStrictEqual(run(waiting, checkIn(UPLOADED_AT - 1_000, [])), waiting);
    assert.deepStrictEqual(
      run(
        waiting,
        BookEvent.MailboxChecked({ status: { checkedInAt: Option.none(), waiting: [] } }),
      ),
      waiting,
    );
  });

  it("needs a check-in after the last item, not just the first", () => {
    assert.deepStrictEqual(run(waiting, checkIn(UPLOADED_AT + 500, [])), waiting);
  });
});

describe("leftInMailbox", () => {
  const thumbnail = ItemName.make("thumbnail_B0TEST_EBOK_portrait.jpg");
  const book = ItemName.make("House of Chains - Steven Erikson.azw3");

  it("finds the item an interrupted upload left behind", () => {
    assert.deepStrictEqual(
      leftInMailbox(book, [thumbnailKey], [thumbnailKey, bookKey], new Set()),
      Option.some(bookKey),
    );
    assert.deepStrictEqual(
      leftInMailbox(thumbnail, [], [thumbnailKey], new Set()),
      Option.some(thumbnailKey),
    );
  });

  it("never takes another book's item", () => {
    assert.deepStrictEqual(leftInMailbox(book, [], [bookKey], new Set([bookKey])), Option.none());
  });

  it("never takes an item that would break upload order", () => {
    const laterThumbnail = itemKey(UPLOADED_AT + 5_000, thumbnail);

    assert.deepStrictEqual(
      leftInMailbox(book, [laterThumbnail], [bookKey, laterThumbnail], new Set()),
      Option.none(),
    );
  });
});

describe("item names", () => {
  const decodeName = Schema.decodeUnknownOption(ItemName);

  it("makes a PDF's name safe for the Kindle's listing and file system", () => {
    for (const [shared, expected] of [
      ["Gardens of the Moon.pdf", "Gardens of the Moon.pdf"],
      ["Tab\tand\nnewline.PDF", "Tab_and_newline.pdf"],
      ["a/b\\c:d.pdf", "a_b_c_d.pdf"],
      ["  .pdf", "untitled.pdf"],
      ["no extension", "no extension.pdf"],
    ] as const) {
      const name = pdfItemName(shared);

      assert.strictEqual<string>(name, expected);
      assert.isTrue(Option.isSome(decodeName(name)));
    }
  });

  it("knows a book by its type, or by its name when the sender does not know the type", () => {
    assert.deepStrictEqual(
      formatOf("book", Option.some("application/epub+zip")),
      Option.some("epub"),
    );
    assert.deepStrictEqual(
      formatOf("Dune.EPUB", Option.some("application/octet-stream")),
      Option.some("epub"),
    );
    assert.deepStrictEqual(formatOf("Dune.pdf", Option.none()), Option.some("pdf"));
    assert.deepStrictEqual(
      formatOf("Dune.mobi", Option.some("application/octet-stream")),
      Option.none(),
    );
  });
});

describe("Book", () => {
  it("survives the round trip through storage", () => {
    const codec = Schema.fromJsonString(Book);
    const stored = bookWith(waiting);

    assert.deepStrictEqual(
      Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(stored)),
      stored,
    );
  });
});
