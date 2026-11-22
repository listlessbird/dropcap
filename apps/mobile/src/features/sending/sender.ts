import { ItemName, type ItemKey, type MailboxStatus } from "@kindle-drop/worker/Api";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { KindleCore } from "../../lib/kindleCore";
import { MailboxClient, type MailboxError } from "../../lib/mailboxClient";
import { BookFiles, type BookFilesError } from "../../persistence/book-files";
import { BookStore, type BookStoreError } from "../../persistence/book-store";
import { ConnectionStore } from "../../persistence/connection-store";
import {
  BookEvent,
  BookId,
  BookStatus,
  claimedItems,
  convertedOf,
  formatOf,
  isConvertible,
  isInFlight,
  isUnconfirmed,
  itemNameOf,
  itemNames,
  leftInMailbox,
  sentAsShared,
  transition,
  waitsForConnection,
  type Book,
  type Converted,
} from "./book";

/** A file shared into the app or picked from storage. */
export interface IncomingFile {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: Option.Option<string>;
}

/** A link to a web article, shared as text. */
export interface IncomingArticle {
  readonly url: string;
  /** The page title the browser shared with the link, shown until the article converts. */
  readonly title: Option.Option<string>;
}

class FileMissing extends Schema.TaggedError<FileMissing>()("FileMissing", {}) {}

export class UnsupportedFile extends Schema.TaggedError<UnsupportedFile>()("UnsupportedFile", {}) {}

// The mailbox expires items after 30 days, so an older book can no longer arrive.
const KEPT_FOR = Duration.days(30);

const SOURCE_EPUB = "source.epub";

const decodeItemName = Schema.decodeUnknownEffect(ItemName);

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const without = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  const rest = new Map(map);

  rest.delete(key);

  return rest;
};

/** Converts and uploads books, and follows them until the Kindle takes them. */
export class Sender extends Context.Service<
  Sender,
  {
    readonly books: Stream.Stream<ReadonlyArray<Book>>;
    /** The fraction of each uploading book's file sent so far. */
    readonly progress: Stream.Stream<ReadonlyMap<BookId, number>>;
    /** Copies the file in and starts converting at once. Unconfirmed books wait for `confirm`. */
    readonly add: (
      file: IncomingFile,
      confirmed: boolean,
    ) => Effect.Effect<BookId, UnsupportedFile | BookFilesError | BookStoreError>;
    /** Starts converting the article at once, fetching its page. Like `add`, without a copy. */
    readonly addArticle: (
      article: IncomingArticle,
      confirmed: boolean,
    ) => Effect.Effect<BookId, BookStoreError>;
    readonly confirm: (id: BookId) => Effect.Effect<void>;
    /** Forgets a book the user never sent, as the share sheet's Cancel does. */
    readonly discard: (id: BookId) => Effect.Effect<void>;
    readonly cancelSending: (
      id: BookId,
    ) => Effect.Effect<void, MailboxError | Cause.NoSuchElementError>;
    readonly retry: (id: BookId) => Effect.Effect<void>;
    /** Removes a finished book from Recent. */
    readonly clear: (id: BookId) => Effect.Effect<void>;
    /**
     * Asks the mailbox what the Kindle took, retries uploads that failed offline, and returns the
     * answer. Fails with NoSuchElementError while no Kindle is connected.
     */
    readonly refresh: Effect.Effect<MailboxStatus, MailboxError | Cause.NoSuchElementError>;
  }
>()("@kindle-drop/mobile/features/sending/Sender") {}

export const make = Effect.gen(function* () {
  const store = yield* BookStore;
  const files = yield* BookFiles;
  const kindleCore = yield* KindleCore;
  const mailbox = yield* MailboxClient;
  const connections = yield* ConnectionStore;

  const books = yield* SubscriptionRef.make<ReadonlyMap<BookId, Book>>(new Map());
  const progress = yield* SubscriptionRef.make<ReadonlyMap<BookId, number>>(new Map());
  // One fiber per book, so a resume, a retry and a confirm never work on the same book at once.
  const work = yield* FiberMap.make<BookId>();
  const writes = yield* Semaphore.make(1);
  // One upload at a time across books. An item another upload just stored, but has not recorded,
  // would otherwise look left over from a crash, and two books could claim it.
  const uploads = yield* Semaphore.make(1);

  const current = (id: BookId) =>
    Effect.map(SubscriptionRef.get(books), (all) => Option.fromNullishOr(all.get(id)));

  /** Moves the stored book along. A book that is gone, or an event that no longer applies, is a no-op. */
  const apply = (id: BookId, event: BookEvent) =>
    writes.withPermit(
      Effect.gen(function* () {
        const book = yield* current(id);

        if (Option.isNone(book)) return book;

        const next = transition(book.value, event);

        if (next !== book.value) {
          yield* store.save(next);
          yield* SubscriptionRef.update(books, (all) => new Map(all).set(id, next));
        }

        return Option.some(next);
      }),
    );

  const put = (book: Book) =>
    writes.withPermit(
      store
        .save(book)
        .pipe(
          Effect.andThen(SubscriptionRef.update(books, (all) => new Map(all).set(book.id, book))),
        ),
    );

  const forget = Effect.fn("Sender.forget")(function* (id: BookId) {
    yield* FiberMap.remove(work, id);
    yield* writes.withPermit(
      store
        .remove(id)
        .pipe(Effect.andThen(SubscriptionRef.update(books, (all) => without(all, id)))),
    );
    yield* files.removeAll(id);
  });

  // The book file is the large one. The thumbnail stays behind as the cover in Recent.
  const removeBookFile = (id: BookId, status: BookStatus) =>
    files.remove(id, [
      SOURCE_EPUB,
      ...Option.toArray(Option.map(convertedOf(status), ({ book }) => book)),
    ]);

  // Whole percents only: native progress fires for every chunk, and every change renders. Called
  // from the native callback, so it updates the ref synchronously.
  const reportProgress = (id: BookId, fraction: number) => {
    const percent = Math.floor(fraction * 100) / 100;

    Effect.runSync(
      SubscriptionRef.update(progress, (all) =>
        all.get(id) === percent ? all : new Map(all).set(id, percent),
      ),
    );
  };

  const connection = connections.load.pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load the Kindle connection.", error).pipe(
        Effect.as(Option.none()),
      ),
    ),
  );

  // An article's page is fetched here, not when it is shared, so a share made offline still goes.
  const convert = Effect.fn("Sender.convert")(function* (id: BookId) {
    const book = yield* current(id);

    if (Option.isNone(book)) return;

    const { source } = book.value;

    const conversion =
      source.format === "article"
        ? kindleCore.convertArticle(source.url, files.path(id))
        : kindleCore.convertEpub(files.path(id, SOURCE_EPUB), files.path(id));

    yield* conversion.pipe(
      Effect.timed,
      Effect.flatMap(([took, output]) =>
        Effect.gen(function* () {
          const name = yield* decodeItemName(basename(output.bookPath));

          const converted: Converted = {
            title: output.title,
            author: output.author,
            book: name,
            bookBytes: yield* files.size(id, name),
            thumbnail: yield* Effect.transposeOption(
              Option.map(Option.fromNullishOr(output.thumbnailName), decodeItemName),
            ),
            convertedIn: Option.some(took),
          };

          return converted;
        }),
      ),
      // A panic in the Rust converter arrives as a defect. It fails the book like any other
      // conversion error, or the book would stay Converting and crash again on every resume.
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Could not convert a book.", cause).pipe(
                Effect.andThen(
                  apply(
                    id,
                    BookEvent.ConvertFailed({
                      reason: Option.exists(
                        Cause.findErrorOption(cause),
                        (error) =>
                          Predicate.isTagged(error, "ConvertError") && error.stage === "Fetch",
                      )
                        ? "unreachable"
                        : "invalid",
                    }),
                  ),
                ),
              ),
        onSuccess: (converted) =>
          apply(id, BookEvent.Converted({ converted })).pipe(
            Effect.andThen(files.remove(id, [SOURCE_EPUB])),
          ),
      }),
    );
  });

  // An AZW3 without a readable cover, such as a personal document with no ASIN, still goes.
  const coverOf = Effect.fn("Sender.coverOf")(function* (id: BookId, book: ItemName) {
    return yield* kindleCore.deviceThumbnail(files.path(id, book), files.path(id)).pipe(
      Effect.flatMap(({ name }) => decodeItemName(name)),
      Effect.asSome,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Could not read an AZW3's cover.", cause).pipe(
              Effect.as(Option.none<ItemName>()),
            ),
      ),
    );
  });

  /** Puts the book's next item in the mailbox, or adopts the copy an interrupted attempt left. */
  const uploadNext = Effect.fn("Sender.uploadNext")(function* (
    id: BookId,
    converted: Converted,
    uploaded: ReadonlyArray<ItemKey>,
  ) {
    const paired = yield* connection;

    // Disconnected: the book stays on this phone and resumes after pairing again.
    if (Option.isNone(paired)) return false;

    const name = itemNames(converted)[uploaded.length];

    if (name === undefined) return false;

    return yield* Effect.gen(function* () {
      const { waiting } = yield* mailbox.status(paired.value);

      const claimed = new Set(
        [...(yield* SubscriptionRef.get(books)).values()].flatMap((book) =>
          book.id === id ? [] : claimedItems(book.status),
        ),
      );

      const left = leftInMailbox(name, uploaded, waiting, claimed);

      // A missing file is no network failure: retrying cannot help, so it is never retried.
      if (Option.isNone(left) && !(yield* files.exists(id, name))) {
        return yield* new FileMissing();
      }

      return yield* Option.match(left, {
        onSome: Effect.succeed,
        onNone: () =>
          mailbox.upload(paired.value, name, files.uri(id, name), (fraction) => {
            if (name === converted.book) reportProgress(id, fraction);
          }),
      });
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.as(
            apply(
              id,
              BookEvent.UploadFailed({
                reason: Predicate.isTagged(error, "FileMissing") ? "missing" : error.reason,
              }),
            ),
            false,
          ),
        onSuccess: (key) => Effect.as(apply(id, BookEvent.ItemUploaded({ key })), true),
      }),
      uploads.withPermit,
    );
  });

  // Changes emit the current value first, so this returns at once if the status already moved.
  const statusChanged = (id: BookId, from: BookStatus) =>
    SubscriptionRef.changes(books).pipe(
      Stream.filter((all) => all.get(id)?.status !== from),
      Stream.take(1),
      Stream.runDrain,
    );

  /**
   * Runs the book's next step, and false once it waits on the Kindle, the user, or a connection.
   * A converted book waits here for its sheet's Send or Cancel, so a Send that lands as conversion
   * finishes is never missed.
   */
  const step = (id: BookId) =>
    Effect.flatMap(current(id), (book) =>
      Option.match(book, {
        onNone: () => Effect.succeed(false),
        onSome: ({ status }) =>
          BookStatus.matchOrElse(
            status,
            {
              Converting: () => Effect.as(convert(id), true),
              Ready: (ready) => Effect.as(statusChanged(id, ready), true),
              Uploading: ({ converted, uploaded }) => uploadNext(id, converted, uploaded),
            },
            () => Effect.succeed(false),
          ),
      }),
    );

  const run = (id: BookId): Effect.Effect<void, BookStoreError | BookFilesError> =>
    Effect.flatMap(step(id), (more) => (more ? run(id) : Effect.void));

  const drive = (id: BookId) =>
    FiberMap.run(
      work,
      id,
      run(id).pipe(
        Effect.catchCause((cause) => Effect.logWarning("Could not send a book.", cause)),
        Effect.ensuring(SubscriptionRef.update(progress, (all) => without(all, id))),
      ),
      { onlyIfMissing: true },
    ).pipe(Effect.asVoid);

  const logFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchCause((cause) => Effect.logWarning("Could not update a book.", cause)),
      Effect.asVoid,
    );

  const prune = Effect.gen(function* () {
    const cutoff = DateTime.subtractDuration(yield* DateTime.now, KEPT_FOR);

    for (const book of (yield* SubscriptionRef.get(books)).values()) {
      if (DateTime.isLessThan(book.addedAt, cutoff)) yield* forget(book.id);
    }
  });

  const deliver = Effect.fn("Sender.deliver")(function* (status: MailboxStatus) {
    for (const book of (yield* SubscriptionRef.get(books)).values()) {
      if (!BookStatus.guards.Waiting(book.status)) continue;

      const next = yield* apply(book.id, BookEvent.MailboxChecked({ status }));

      if (Option.exists(next, (moved) => BookStatus.guards.OnKindle(moved.status))) {
        yield* removeBookFile(book.id, book.status);
      }
    }
  });

  // A cleared failed upload keeps its record until the mailbox confirms its items are gone, so a
  // stray cover never reaches the Kindle because the phone was offline when the user cleared it.
  const removeLeftovers = Effect.fn("Sender.removeLeftovers")(function* (id: BookId) {
    const book = yield* current(id);
    const paired = yield* connection;

    if (Option.isNone(paired)) return;

    const items = Option.match(book, {
      onNone: (): ReadonlyArray<ItemKey> => [],
      onSome: ({ status }) =>
        BookStatus.matchOrElse(status, { Clearing: ({ items }) => items }, () => []),
    });

    if (items.length === 0) return;

    yield* Effect.forEach(items, (key) => mailbox.cancel(paired.value, key), { discard: true });
    yield* forget(id);
  });

  // The mailbox answered, so the phone is online: retry what failed for want of a connection.
  const resume = Effect.gen(function* () {
    for (const book of (yield* SubscriptionRef.get(books)).values()) {
      const offline = BookStatus.matchOrElse(
        book.status,
        {
          UploadFailed: ({ reason }) => reason === "unreachable",
          ConvertFailed: (failed) => failed.confirmed && waitsForConnection(failed),
        },
        () => false,
      );

      if (offline) yield* apply(book.id, BookEvent.Retried());
    }

    for (const book of (yield* SubscriptionRef.get(books)).values()) {
      if (isInFlight(book.status)) yield* drive(book.id);

      if (BookStatus.guards.Clearing(book.status)) {
        yield* removeLeftovers(book.id).pipe(Effect.ignore);
      }
    }
  });

  // A previous process may have died mid-send. Unconfirmed books lost their sheet with it, and a
  // directory without a record is a discarded share whose conversion finished afterwards.
  const recover = Effect.gen(function* () {
    const { books: stored, unreadable } = yield* store.list;
    const kept = stored.filter((book) => !isUnconfirmed(book.status));

    for (const book of stored) {
      if (isUnconfirmed(book.status)) yield* store.remove(book.id);
    }

    yield* SubscriptionRef.set(books, new Map(kept.map((book) => [book.id, book])));

    // A row this version cannot read still owns its files.
    const known = new Set<string>([...kept.map((book) => book.id), ...unreadable]);

    for (const directory of yield* files.stored) {
      if (!known.has(directory)) yield* files.removeAll(directory);
    }

    for (const book of kept) {
      if (isInFlight(book.status)) yield* drive(book.id);
    }
  });

  yield* logFailure(recover);

  const newId = Effect.gen(function* () {
    const time = (yield* Clock.currentTimeMillis).toString(36);
    const salt = (yield* Random.nextIntBetween(0, 36 ** 6)).toString(36);

    return BookId.make(`${time}-${salt}`);
  });

  const start = Effect.fn("Sender.start")(function* (added: Book, confirmed: boolean) {
    yield* put(confirmed ? transition(added, BookEvent.Confirmed()) : added);
    yield* drive(added.id);

    return added.id;
  });

  return Sender.of({
    books: Stream.map(SubscriptionRef.changes(books), (all) => [...all.values()]),
    progress: SubscriptionRef.changes(progress),
    add: Effect.fn("Sender.add")(function* (file, confirmed) {
      const format = yield* Effect.fromOption(formatOf(file.name, file.mimeType)).pipe(
        Effect.mapError(() => new UnsupportedFile()),
      );

      const id = yield* newId;
      const name = itemNameOf(file.name, format);
      const storedAs = isConvertible(format) ? SOURCE_EPUB : name;

      // Also on interruption, as when the user leaves a share sheet while a large file copies.
      const { bytes, thumbnail } = yield* Effect.gen(function* () {
        const bytes = yield* files.copyIn(id, file.uri, storedAs);

        return {
          bytes,
          thumbnail: format === "azw3" ? yield* coverOf(id, name) : Option.none<ItemName>(),
        };
      }).pipe(Effect.onError(() => files.removeAll(id)));

      const source = { name: file.name, format, bytes };

      return yield* start(
        {
          id,
          addedAt: yield* DateTime.now,
          source,
          status: isConvertible(format)
            ? BookStatus.cases.Converting.make({ confirmed })
            : BookStatus.cases.Ready.make({ converted: sentAsShared(source, name, thumbnail) }),
        },
        confirmed,
      );
    }),
    addArticle: Effect.fn("Sender.addArticle")(function* (article, confirmed) {
      return yield* start(
        {
          id: yield* newId,
          addedAt: yield* DateTime.now,
          source: {
            name: Option.getOrElse(article.title, () => article.url),
            format: "article",
            url: article.url,
          },
          status: BookStatus.cases.Converting.make({ confirmed }),
        },
        confirmed,
      );
    }),
    confirm: (id) => logFailure(apply(id, BookEvent.Confirmed()).pipe(Effect.andThen(drive(id)))),
    discard: (id) =>
      logFailure(
        Effect.flatMap(current(id), (book) =>
          Option.exists(book, ({ status }) => isUnconfirmed(status)) ? forget(id) : Effect.void,
        ),
      ),
    cancelSending: Effect.fn("Sender.cancelSending")(function* (id) {
      const paired = yield* Effect.fromOption(yield* connection);

      // The Kindle may have taken the book since the Library last asked, and removing an item that
      // is already gone still succeeds. So ask first, and cancel only what still waits.
      const status = yield* mailbox.status(paired);

      yield* logFailure(deliver(status));

      const { status: book } = yield* Effect.fromOption(yield* current(id));

      if (!BookStatus.guards.Waiting(book)) return;

      const left = book.items.filter((key) => status.waiting.includes(key));

      yield* Effect.forEach(left, (key) => mailbox.cancel(paired, key), { discard: true });

      yield* logFailure(
        Effect.gen(function* () {
          // With the book itself gone, only its cover was left: the book is on the Kindle.
          const after = status.waiting.includes(Arr.lastNonEmpty(book.items))
            ? Option.none()
            : yield* apply(
                id,
                BookEvent.MailboxChecked({
                  status: {
                    ...status,
                    waiting: status.waiting.filter((key) => !left.includes(key)),
                  },
                }),
              );

          if (!Option.exists(after, (moved) => BookStatus.guards.OnKindle(moved.status))) {
            yield* apply(id, BookEvent.SendingCanceled({ at: yield* DateTime.now }));
          }

          yield* removeBookFile(id, book);
        }),
      );
    }),
    retry: (id) => logFailure(apply(id, BookEvent.Retried()).pipe(Effect.andThen(drive(id)))),
    clear: (id) =>
      logFailure(
        Effect.gen(function* () {
          const book = yield* current(id);

          if (Option.isNone(book)) return;

          // Only a failed upload left items the Kindle should never get. A delivered book's items
          // are already gone from the mailbox.
          const left = BookStatus.matchOrElse(
            book.value.status,
            { UploadFailed: ({ uploaded }) => uploaded },
            () => [],
          );

          if (left.length === 0) return yield* forget(id);

          yield* apply(id, BookEvent.Cleared());
          yield* files.removeAll(id);
          yield* removeLeftovers(id);
        }),
      ),
    refresh: Effect.gen(function* () {
      yield* logFailure(prune);

      const paired = yield* Effect.fromOption(yield* connection);
      const status = yield* mailbox.status(paired);

      yield* logFailure(deliver(status));
      yield* logFailure(resume);

      return status;
    }).pipe(Effect.withSpan("Sender.refresh")),
  });
});

export const layer = Layer.effect(Sender, make);
