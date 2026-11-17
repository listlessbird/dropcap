import { assert, describe, it } from "@effect/vitest";
import { ItemName, itemKey, nameOfKey, type ItemKey } from "@kindle-drop/worker/Api";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { Connection } from "../../lib/connection";
import { ConvertError, KindleCore } from "../../lib/kindleCore";
import { MailboxClient, MailboxError } from "../../lib/mailboxClient";
import { BookFiles } from "../../persistence/book-files";
import { BookStore } from "../../persistence/book-store";
import { ConnectionStore } from "../../persistence/connection-store";
import { BookId, BookStatus, type Book, type Converted } from "./book";
import * as Sending from "./sender";
import { Sender } from "./sender";

const BOOK = ItemName.make("House of Chains - Steven Erikson.azw3");
const THUMBNAIL = ItemName.make("thumbnail_B0TEST_EBOK_portrait.jpg");

const connection = Schema.decodeUnknownSync(Connection)({
  server: "https://mailbox.example.dev",
  key: "dev-app",
});

const { Converting, ConvertFailed, Ready, Uploading, Waiting } = BookStatus.cases;

const converted: Converted = {
  title: "House of Chains",
  author: "Steven Erikson",
  book: BOOK,
  bookBytes: 2_400_000,
  thumbnail: Option.some(THUMBNAIL),
  convertedIn: Option.none(),
};

const storedBook = (id: string, status: BookStatus): Book => ({
  id: BookId.make(id),
  addedAt: DateTime.makeUnsafe(0),
  source: { name: "House of Chains - Steven Erikson.epub", format: "epub", bytes: 9_100_000 },
  status,
});

const epub = {
  uri: "content://downloads/1",
  name: "House of Chains - Steven Erikson.epub",
  mimeType: Option.some("application/epub+zip"),
};

interface Overrides {
  readonly convertEpub?: KindleCore["Service"]["convertEpub"];
}

const notAnEpub = new ConvertError({ stage: "Epub", message: "invalid zip archive" });

/** A phone with a stored set of books and a mailbox, both in memory. */
const world = (
  books: ReadonlyArray<Book>,
  mailboxItems: ReadonlyArray<ItemKey> = [],
  overrides: Overrides = {},
) =>
  Effect.gen(function* () {
    const rows = yield* Ref.make<ReadonlyMap<string, Book>>(new Map(books.map((b) => [b.id, b])));
    const waiting = yield* Ref.make(mailboxItems);
    const uploads = yield* Ref.make<ReadonlyArray<string>>([]);
    const online = yield* Ref.make(true);
    const checkedInAt = yield* Ref.make(Option.none<DateTime.Utc>());
    const directories = yield* Ref.make<ReadonlyArray<string>>(books.map((book) => book.id));
    const removed = yield* Ref.make<ReadonlyArray<string>>([]);

    const store = Layer.succeed(
      BookStore,
      BookStore.of({
        list: Effect.map(Ref.get(rows), (all) => [...all.values()]),
        save: (book) => Ref.update(rows, (all) => new Map(all).set(book.id, book)),
        remove: (id) => Ref.update(rows, (all) => new Map([...all].filter(([key]) => key !== id))),
      }),
    );

    const files = Layer.succeed(
      BookFiles,
      BookFiles.of({
        copyIn: (id) =>
          Effect.as(
            Ref.update(directories, (all) => [...all, id]),
            9_100_000,
          ),
        size: () => Effect.succeed(2_400_000),
        path: (id, name) => (name === undefined ? `/books/${id}` : `/books/${id}/${name}`),
        uri: (id, name) => `file:///books/${id}/${name}`,
        remove: (id, names) =>
          Ref.update(removed, (all) => [...all, ...names.map((n) => `${id}/${n}`)]),
        removeAll: (id) =>
          Ref.update(directories, (all) => all.filter((directory) => directory !== id)),
        stored: Ref.get(directories),
      }),
    );

    const kindleCore = Layer.succeed(
      KindleCore,
      KindleCore.of({
        convertEpub:
          overrides.convertEpub ??
          ((_, outDir) =>
            Effect.succeed({
              bookPath: `${outDir}/${BOOK}`,
              thumbnailName: THUMBNAIL,
              thumbnailPath: `${outDir}/${THUMBNAIL}`,
              title: "House of Chains",
              author: "Steven Erikson",
            })),
      }),
    );

    const unreachable = new MailboxError({ reason: "unreachable", cause: null });

    const whenOnline = <A>(effect: Effect.Effect<A>) =>
      Effect.flatMap(Ref.get(online), (up) => (up ? effect : Effect.fail(unreachable)));

    const mailbox = Layer.succeed(
      MailboxClient,
      MailboxClient.of({
        status: () =>
          whenOnline(Effect.all({ checkedInAt: Ref.get(checkedInAt), waiting: Ref.get(waiting) })),
        cancel: (_, id) =>
          whenOnline(Ref.update(waiting, (all) => all.filter((key) => key !== id))),
        upload: (_, name) =>
          whenOnline(
            Effect.gen(function* () {
              // Each upload is a later request, as it is against the real Worker.
              yield* TestClock.adjust("1 second");

              const key = itemKey(yield* Clock.currentTimeMillis, name);

              yield* Ref.update(waiting, (all) => [...all, key].sort());
              yield* Ref.update(uploads, (all) => [...all, name]);

              return key;
            }),
          ),
      }),
    );

    const connections = Layer.succeed(
      ConnectionStore,
      ConnectionStore.of({
        load: Effect.succeedSome(connection),
        save: () => Effect.void,
        clear: Effect.void,
      }),
    );

    const layer = Sending.layer.pipe(
      Layer.provide(Layer.mergeAll(store, files, kindleCore, mailbox, connections)),
    );

    /** The Kindle wakes: it lists the mailbox, downloads everything, and removes it. */
    const kindleWakes = Effect.gen(function* () {
      yield* TestClock.adjust("1 minute");
      yield* Ref.set(checkedInAt, Option.some(yield* DateTime.now));
      yield* Ref.set(waiting, []);
    });

    return { layer, rows, waiting, uploads, online, directories, removed, kindleWakes };
  });

const statusOf = (id: BookId) =>
  Sender.use((sender) =>
    sender.books.pipe(
      Stream.map((books) => books.find((book) => book.id === id)?.status),
      Stream.runHead,
      Effect.map(Option.flatMap(Option.fromNullishOr)),
    ),
  );

/** Waits for the milestone rather than for time to pass. */
const until = (id: BookId, tag: BookStatus["_tag"]) =>
  Sender.use((sender) =>
    sender.books.pipe(
      Stream.filter((books) => books.some((book) => book.id === id && book.status._tag === tag)),
      Stream.runHead,
    ),
  );

describe("Sender", () => {
  it.effect("converts and sends a confirmed book, thumbnail first", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "Waiting");

        const keys = yield* Ref.get(phone.waiting);

        assert.deepStrictEqual(keys.map(nameOfKey), [THUMBNAIL, BOOK]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("resumes an interrupted upload without sending a second copy", () =>
    Effect.gen(function* () {
      // The app died after the mailbox stored the thumbnail but before the record heard about it.
      const left = itemKey(1_000, THUMBNAIL);

      const phone = yield* world(
        [storedBook("b1", Uploading.make({ converted, uploaded: [] }))],
        [left],
      );

      yield* Effect.gen(function* () {
        const status = yield* until(BookId.make("b1"), "Waiting").pipe(
          Effect.andThen(statusOf(BookId.make("b1"))),
        );

        assert.deepStrictEqual(yield* Ref.get(phone.uploads), [BOOK]);
        assert.deepStrictEqual(
          Option.map(status, (s) => (BookStatus.guards.Waiting(s) ? s.items[0] : undefined)),
          Option.some(left),
        );
        assert.strictEqual((yield* Ref.get(phone.waiting)).length, 2);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("never adopts an item another book holds", () =>
    Effect.gen(function* () {
      const theirs = itemKey(1_000, THUMBNAIL);

      const phone = yield* world(
        [
          storedBook("b0", Waiting.make({ converted, items: [theirs, itemKey(1_500, BOOK)] })),
          storedBook("b1", Uploading.make({ converted, uploaded: [] })),
        ],
        [theirs, itemKey(1_500, BOOK)],
      );

      yield* until(BookId.make("b1"), "Waiting").pipe(Effect.provide(phone.layer));

      assert.deepStrictEqual(yield* Ref.get(phone.uploads), [THUMBNAIL, BOOK]);
    }),
  );

  it.effect("drops the unconfirmed books and stray files a previous process left", () =>
    Effect.gen(function* () {
      const phone = yield* world([
        storedBook("ready", Ready.make({ converted })),
        storedBook("converting", Converting.make({ confirmed: false })),
        storedBook("sent", Waiting.make({ converted, items: [itemKey(1_000, BOOK)] })),
      ]);

      yield* Ref.update(phone.directories, (all) => [...all, "orphan"]);
      yield* Effect.scoped(Layer.build(phone.layer));

      assert.deepStrictEqual([...(yield* Ref.get(phone.rows)).keys()], ["sent"]);
      assert.deepStrictEqual(yield* Ref.get(phone.directories), ["sent"]);
    }),
  );

  it.effect("retries an upload that failed offline once the mailbox answers", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Ref.set(phone.online, false);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "UploadFailed");
        yield* Ref.set(phone.online, true);
        yield* sender.refresh;
        yield* until(id, "Waiting");

        assert.deepStrictEqual(yield* Ref.get(phone.uploads), [THUMBNAIL, BOOK]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("waits at Ready for Send, then uploads", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, false);

        yield* until(id, "Ready");
        assert.deepStrictEqual(yield* Ref.get(phone.uploads), []);

        yield* sender.confirm(id);
        yield* until(id, "Waiting");
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("is on the Kindle after it wakes, and keeps only the cover", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "Waiting");
        yield* sender.refresh;
        assert.isTrue(Option.exists(yield* statusOf(id), BookStatus.guards.Waiting));

        yield* phone.kindleWakes;
        yield* sender.refresh;
        yield* until(id, "OnKindle");

        const removed = yield* Ref.get(phone.removed);

        assert.isTrue(removed.includes(`${id}/${BOOK}`));
        assert.isFalse(removed.includes(`${id}/${THUMBNAIL}`));
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("cancels sending by removing its items from the mailbox", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "Waiting");
        yield* sender.cancelSending(id);

        assert.deepStrictEqual(yield* Ref.get(phone.waiting), []);
        yield* until(id, "Canceled");
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("tells a file it cannot send apart from a book", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      const error = yield* Effect.flip(
        Sender.use((sender) =>
          sender.add(
            { uri: "content://x", name: "notes.txt", mimeType: Option.some("text/plain") },
            true,
          ),
        ).pipe(Effect.provide(phone.layer)),
      );

      assert.strictEqual(error._tag, "UnsupportedFile");
    }),
  );

  it.effect("keeps a sent book whose conversion failed when its sheet closes", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], { convertEpub: () => Effect.fail(notAnEpub) });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "ConvertFailed");
        yield* sender.discard(id);

        assert.isTrue(Option.exists(yield* statusOf(id), BookStatus.guards.ConvertFailed));
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("drops a failed conversion nobody sent once its sheet is gone", () =>
    Effect.gen(function* () {
      const phone = yield* world([storedBook("unsent", ConvertFailed.make({ confirmed: false }))]);

      yield* Effect.scoped(Layer.build(phone.layer));

      assert.deepStrictEqual([...(yield* Ref.get(phone.rows)).keys()], []);
    }),
  );

  it.effect("fails the book when the converter crashes instead of leaving it converting", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], {
        convertEpub: () => Effect.die(new Error("Rust panicked in kindling")),
      });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "ConvertFailed");
      }).pipe(Effect.provide(phone.layer));
    }),
  );
});
