import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { Book, type BookId } from "../features/sending/book";
import * as MobileDatabase from "./mobile-database";

const BookJson = Schema.fromJsonString(Book);
const decodeBookJson = Schema.decodeUnknownOption(BookJson);
const encodeBookJson = Schema.encodeEffect(BookJson);

export class BookStoreError extends Schema.TaggedError<BookStoreError>()("BookStoreError", {
  operation: Schema.Literals(["list", "save", "remove"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not ${this.operation} books.`;
  }
}

/** One SQLite row per book, so a crash mid-send leaves the last status it reached. */
export class BookStore extends Context.Service<
  BookStore,
  {
    /**
     * The books, and the ids of rows this version cannot read, such as ones a newer version wrote.
     * Their files are left alone.
     */
    readonly list: Effect.Effect<
      { readonly books: ReadonlyArray<Book>; readonly unreadable: ReadonlyArray<string> },
      BookStoreError
    >;
    readonly save: (book: Book) => Effect.Effect<void, BookStoreError>;
    readonly remove: (id: BookId) => Effect.Effect<void, BookStoreError>;
  }
>()("@kindle-drop/mobile/persistence/BookStore") {}

export const make = Effect.gen(function* () {
  const database = yield* MobileDatabase.MobileDatabase;

  const storeError = (operation: BookStoreError["operation"]) => (cause: unknown) =>
    new BookStoreError({ operation, cause });

  return BookStore.of({
    // A row this version cannot read drops out rather than hiding every other book.
    list: database.loadBooksJson.pipe(
      Effect.map((rows) => {
        const decoded = rows.map(({ id, payload }) => ({ id, book: decodeBookJson(payload) }));

        return {
          books: decoded.flatMap(({ book }) => Option.toArray(book)),
          unreadable: decoded.flatMap(({ id, book }) => (Option.isNone(book) ? [id] : [])),
        };
      }),
      Effect.mapError(storeError("list")),
      Effect.withSpan("BookStore.list"),
    ),
    save: Effect.fn("BookStore.save")(function* (book) {
      const payload = yield* encodeBookJson(book).pipe(Effect.mapError(storeError("save")));

      yield* database
        .saveBookJson(book.id, DateTime.toEpochMillis(book.addedAt), payload)
        .pipe(Effect.mapError(storeError("save")));
    }),
    remove: Effect.fn("BookStore.remove")((id) =>
      database.deleteBook(id).pipe(Effect.mapError(storeError("remove"))),
    ),
  });
});

export const layer = Layer.effect(BookStore, make);
