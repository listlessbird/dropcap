import { assert, describe, it } from "@effect/vitest";
import { ItemName, itemKey, nameOfKey, type ItemKey } from "@kindle-drop/worker/Api";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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

const { Converting, ConvertFailed, OnKindle, Ready, Uploading, UploadFailed, Waiting } =
  BookStatus.cases;

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

const ARTICLE = ItemName.make("Flood Season - Ada Byline.azw3");

const article = { url: "https://example.com/flood-season", title: Option.some("Flood Season") };

const articleConverted = (outDir: string) =>
  Effect.succeed({
    bookPath: `${outDir}/${ARTICLE}`,
    thumbnailName: THUMBNAIL,
    thumbnailPath: `${outDir}/${THUMBNAIL}`,
    title: "Flood Season",
    author: "Ada Byline",
  });

const offline = new ConvertError({ stage: "Fetch", message: "no route to host" });

const azw3 = {
  uri: "content://downloads/2",
  name: "House of Chains - Steven Erikson.azw3",
  mimeType: Option.some("application/octet-stream"),
};

interface Overrides {
  readonly convertEpub?: KindleCore["Service"]["convertEpub"];
  readonly convertArticle?: KindleCore["Service"]["convertArticle"];
  readonly deviceThumbnail?: KindleCore["Service"]["deviceThumbnail"];
  /** Whether the book files on this phone are gone, as after the user cleared app storage. */
  readonly filesMissing?: boolean;
  /** Stored rows this version of the app cannot read. */
  readonly unreadable?: ReadonlyArray<string>;
  /** Holds every copy into the app after it started, as a large file does. */
  readonly holdCopy?: {
    readonly started: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  };
  /** Holds the first upload after the mailbox stored it, before the app hears back. */
  readonly holdFirstUpload?: {
    readonly stored: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  };
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
    const removed = yield* Ref.make<ReadonlyArray<string>>([]);

    const directories = yield* Ref.make<ReadonlyArray<string>>([
      ...books.map((book) => book.id),
      ...(overrides.unreadable ?? []),
    ]);

    const uploadCalls = yield* Ref.make(0);

    const store = Layer.succeed(
      BookStore,
      BookStore.of({
        list: Effect.map(Ref.get(rows), (all) => ({
          books: [...all.values()],
          unreadable: overrides.unreadable ?? [],
        })),
        save: (book) => Ref.update(rows, (all) => new Map(all).set(book.id, book)),
        remove: (id) => Ref.update(rows, (all) => new Map([...all].filter(([key]) => key !== id))),
      }),
    );

    const files = Layer.succeed(
      BookFiles,
      BookFiles.of({
        copyIn: (id) =>
          Effect.gen(function* () {
            yield* Ref.update(directories, (all) => [...all, id]);

            if (overrides.holdCopy) {
              yield* Deferred.succeed(overrides.holdCopy.started, undefined);
              yield* Deferred.await(overrides.holdCopy.release);
            }

            return 9_100_000;
          }),
        size: () => Effect.succeed(2_400_000),
        exists: () => Effect.succeed(!overrides.filesMissing),
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
        convertArticle: overrides.convertArticle ?? ((_, outDir) => articleConverted(outDir)),
        deviceThumbnail:
          overrides.deviceThumbnail ??
          ((_, outDir) => Effect.succeed({ name: THUMBNAIL, path: `${outDir}/${THUMBNAIL}` })),
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

              const hold = overrides.holdFirstUpload;

              if (hold && (yield* Ref.getAndUpdate(uploadCalls, (n) => n + 1)) === 0) {
                yield* Deferred.succeed(hold.stored, undefined);
                yield* Deferred.await(hold.release);
              }

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

    /** The Kindle wakes and takes only the items `took` keeps, as when a download times out. */
    const kindleTakes = (took: (key: ItemKey) => boolean) =>
      Effect.gen(function* () {
        yield* TestClock.adjust("1 minute");
        yield* Ref.set(checkedInAt, Option.some(yield* DateTime.now));
        yield* Ref.update(waiting, (all) => all.filter((key) => !took(key)));
      });

    return {
      layer,
      rows,
      waiting,
      uploads,
      online,
      directories,
      removed,
      kindleWakes,
      kindleTakes,
    };
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

  it.effect("sends an AZW3 as it is, with the cover it carries first", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], {
        convertEpub: () => Effect.die(new Error("An AZW3 is never converted.")),
      });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(azw3, true);

        yield* until(id, "Waiting");

        assert.deepStrictEqual(yield* Ref.get(phone.uploads), [THUMBNAIL, BOOK]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("sends an AZW3 without a cover when it carries none", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], {
        deviceThumbnail: () =>
          Effect.fail(new ConvertError({ stage: "Thumbnail", message: "no ASIN" })),
      });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(azw3, true);

        yield* until(id, "Waiting");

        assert.deepStrictEqual(yield* Ref.get(phone.uploads), [BOOK]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("sends a text file as it is", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], {
        convertEpub: () => Effect.die(new Error("A text file is never converted.")),
      });

      yield* Effect.gen(function* () {
        const txt = { uri: "content://x", name: "notes.txt", mimeType: Option.some("text/plain") };
        const id = yield* Sender.use((sender) => sender.add(txt, true));

        yield* until(id, "Waiting");

        assert.deepStrictEqual(yield* Ref.get(phone.uploads), ["notes.txt"]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("sends a book without a cover by itself", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], {
        convertEpub: (_, outDir) =>
          Effect.succeed({ bookPath: `${outDir}/${BOOK}`, title: "House of Chains", author: "" }),
      });

      yield* Effect.gen(function* () {
        const id = yield* Sender.use((sender) => sender.add(epub, true));

        yield* until(id, "Waiting");

        assert.deepStrictEqual(yield* Ref.get(phone.uploads), [BOOK]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("converts a shared article from its page and sends it", () =>
    Effect.gen(function* () {
      const fetched = yield* Ref.make<ReadonlyArray<string>>([]);

      const phone = yield* world([], [], {
        convertArticle: (url, outDir) =>
          Ref.update(fetched, (all) => [...all, url]).pipe(
            Effect.andThen(articleConverted(outDir)),
          ),
      });

      yield* Effect.gen(function* () {
        const id = yield* Sender.use((sender) => sender.addArticle(article, true));

        yield* until(id, "Waiting");

        assert.deepStrictEqual(yield* Ref.get(fetched), [article.url]);
        assert.deepStrictEqual(yield* Ref.get(phone.uploads), [THUMBNAIL, ARTICLE]);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("fetches an article again once the phone is back online", () =>
    Effect.gen(function* () {
      const reachable = yield* Ref.make(false);

      const phone = yield* world([], [], {
        convertArticle: (_, outDir) =>
          Effect.flatMap(Ref.get(reachable), (up) =>
            up ? articleConverted(outDir) : Effect.fail(offline),
          ),
      });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.addArticle(article, true);

        yield* until(id, "ConvertFailed");
        yield* Ref.set(reachable, true);
        yield* sender.refresh;
        yield* until(id, "Waiting");
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("keeps an article sent from its sheet while offline, and sends it once online", () =>
    Effect.gen(function* () {
      const reachable = yield* Ref.make(false);

      const phone = yield* world([], [], {
        convertArticle: (_, outDir) =>
          Effect.flatMap(Ref.get(reachable), (up) =>
            up ? articleConverted(outDir) : Effect.fail(offline),
          ),
      });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.addArticle(article, false);

        yield* until(id, "ConvertFailed");
        yield* sender.confirm(id);
        // The sheet closes after Send, which discards only a book the user never sent.
        yield* sender.discard(id);
        yield* Ref.set(reachable, true);
        yield* sender.refresh;
        yield* until(id, "Waiting");
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("never fetches a page again when it has no article", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);

      const phone = yield* world([], [], {
        convertArticle: () =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail(new ConvertError({ stage: "Article", message: "404" }))),
          ),
      });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.addArticle(article, true);

        yield* until(id, "ConvertFailed");
        yield* sender.refresh;

        assert.strictEqual(yield* Ref.get(calls), 1);
        assert.deepStrictEqual(
          yield* statusOf(id),
          Option.some(ConvertFailed.make({ confirmed: true, reason: "invalid" })),
        );
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
            { uri: "content://x", name: "notes.docx", mimeType: Option.some("application/msword") },
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
      const phone = yield* world([
        storedBook("unsent", ConvertFailed.make({ confirmed: false, reason: "invalid" })),
      ]);

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

  it.effect("lands on On Kindle when Cancel sending comes after the Kindle took the book", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "Waiting");
        yield* phone.kindleWakes;
        yield* sender.cancelSending(id);

        assert.isTrue(Option.exists(yield* statusOf(id), BookStatus.guards.OnKindle));
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("cancels the book still waiting when the Kindle took only its cover", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "Waiting");
        yield* phone.kindleTakes((key) => nameOfKey(key) === THUMBNAIL);
        yield* sender.cancelSending(id);

        assert.isTrue(Option.exists(yield* statusOf(id), BookStatus.guards.Canceled));
        assert.deepStrictEqual(yield* Ref.get(phone.waiting), []);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("lands on On Kindle when the Kindle took the book but not its cover", () =>
    Effect.gen(function* () {
      const phone = yield* world([]);

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const id = yield* sender.add(epub, true);

        yield* until(id, "Waiting");
        yield* phone.kindleTakes((key) => nameOfKey(key) === BOOK);
        yield* sender.cancelSending(id);

        assert.isTrue(Option.exists(yield* statusOf(id), BookStatus.guards.OnKindle));
        assert.deepStrictEqual(yield* Ref.get(phone.waiting), []);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("never lets two sends of the same book share a mailbox item", () =>
    Effect.gen(function* () {
      const stored = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const phone = yield* world([], [], { holdFirstUpload: { stored, release } });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const first = yield* sender.add(epub, true);

        // The first cover is in the mailbox, and its book has not recorded it yet.
        yield* Deferred.await(stored);

        const second = yield* sender.add(epub, true);

        yield* Deferred.succeed(release, undefined);
        yield* until(first, "Waiting");
        yield* until(second, "Waiting");

        const itemsOf = (id: BookId) =>
          Effect.map(statusOf(id), (status) =>
            Option.match(Option.filter(status, BookStatus.guards.Waiting), {
              onNone: (): ReadonlyArray<ItemKey> => [],
              onSome: ({ items }) => items,
            }),
          );

        const firstItems = yield* itemsOf(first);
        const secondItems = yield* itemsOf(second);

        assert.deepStrictEqual(
          firstItems.filter((key) => secondItems.includes(key)),
          [],
        );
        assert.strictEqual((yield* Ref.get(phone.waiting)).length, 4);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("keeps removing a failed upload's stray cover after it is cleared offline", () =>
    Effect.gen(function* () {
      const cover = itemKey(1_000, THUMBNAIL);

      const phone = yield* world(
        [
          storedBook(
            "b1",
            UploadFailed.make({ converted, uploaded: [cover], reason: "unexpected" }),
          ),
        ],
        [cover],
      );

      yield* Effect.gen(function* () {
        const sender = yield* Sender;

        yield* Ref.set(phone.online, false);
        yield* sender.clear(BookId.make("b1"));

        assert.deepStrictEqual(yield* Ref.get(phone.waiting), [cover]);

        yield* Ref.set(phone.online, true);
        yield* sender.refresh;

        assert.deepStrictEqual(yield* Ref.get(phone.waiting), []);
        assert.isFalse((yield* Ref.get(phone.rows)).has("b1"));
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("stops a send whose book file is gone instead of retrying it", () =>
    Effect.gen(function* () {
      const phone = yield* world(
        [storedBook("b1", Uploading.make({ converted, uploaded: [] }))],
        [],
        { filesMissing: true },
      );

      yield* Effect.gen(function* () {
        const sender = yield* Sender;

        yield* until(BookId.make("b1"), "UploadFailed");
        yield* sender.refresh;

        assert.deepStrictEqual(
          Option.map(yield* statusOf(BookId.make("b1")), (status) =>
            BookStatus.guards.UploadFailed(status) ? status.reason : status._tag,
          ),
          Option.some("missing"),
        );
        assert.deepStrictEqual(yield* Ref.get(phone.uploads), []);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("keeps the files of a stored book this version cannot read", () =>
    Effect.gen(function* () {
      const phone = yield* world([], [], { unreadable: ["from-a-newer-version"] });

      yield* Effect.scoped(Layer.build(phone.layer));

      assert.deepStrictEqual(yield* Ref.get(phone.directories), ["from-a-newer-version"]);
    }),
  );

  it.effect("leaves nothing behind when a share is abandoned mid-copy", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const phone = yield* world([], [], { holdCopy: { started, release } });

      yield* Effect.gen(function* () {
        const sender = yield* Sender;
        const adding = yield* Effect.forkChild(sender.add(epub, false));

        yield* Deferred.await(started);
        yield* Fiber.interrupt(adding);

        assert.deepStrictEqual(yield* Ref.get(phone.directories), []);
        assert.strictEqual((yield* Ref.get(phone.rows)).size, 0);
      }).pipe(Effect.provide(phone.layer));
    }),
  );

  it.effect("clears a book that is on the Kindle from Recent", () =>
    Effect.gen(function* () {
      const items = [itemKey(1_000, THUMBNAIL), itemKey(1_500, BOOK)] as const;

      const phone = yield* world([
        storedBook(
          "b1",
          OnKindle.make({ converted, items, arrivedAt: DateTime.makeUnsafe(2_000) }),
        ),
      ]);

      yield* Effect.gen(function* () {
        yield* Sender.use((sender) => sender.clear(BookId.make("b1")));

        assert.isFalse((yield* Ref.get(phone.rows)).has("b1"));
      }).pipe(Effect.provide(phone.layer));
    }),
  );
});
