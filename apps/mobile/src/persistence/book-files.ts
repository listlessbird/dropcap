import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { BookId } from "../features/sending/book";

/** Under the app's documents directory. Covers render straight from here. */
export const BOOKS_DIRECTORY = "books";

export class BookFilesError extends Schema.TaggedError<BookFilesError>()("BookFilesError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Could not copy the book into the app.";
  }
}

/**
 * Each book's files, in `<documents>/books/<id>/`: the copied share, the converter's output, and
 * the thumbnail, which outlives the book file so Recent keeps its cover.
 */
export class BookFiles extends Context.Service<
  BookFiles,
  {
    /** Copies a `content://` or `file://` URI in as `name` and returns its size in bytes. */
    readonly copyIn: (
      id: BookId,
      from: string,
      name: string,
    ) => Effect.Effect<number, BookFilesError>;
    readonly size: (id: BookId, name: string) => Effect.Effect<number, BookFilesError>;
    /** A file system path, as the Rust converter takes it. Without a name, the book's directory. */
    readonly path: (id: BookId, name?: string) => string;
    /** A `file://` URI, as images and uploads take it. */
    readonly uri: (id: BookId, name: string) => string;
    readonly remove: (id: BookId, names: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly removeAll: (id: string) => Effect.Effect<void>;
    /** Directory names, which are book ids, including any whose record is gone. */
    readonly stored: Effect.Effect<ReadonlyArray<string>>;
  }
>()("@kindle-drop/mobile/persistence/BookFiles") {}

export const make = Effect.gen(function* () {
  // Imported lazily so Node tests can load this module without the native binding.
  const { Directory, File, Paths } = yield* Effect.promise(() => import("expo-file-system"));

  const root = new Directory(Paths.document, BOOKS_DIRECTORY);
  const directory = (id: string) => new Directory(root, id);
  const file = (id: BookId, name: string) => new File(directory(id), name);

  const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

  // Deleting is cleanup. A file that is already gone, or busy, is left for the next prune.
  const quietly = (effect: () => void) => Effect.sync(effect).pipe(Effect.ignoreCause);

  return BookFiles.of({
    copyIn: Effect.fn("BookFiles.copyIn")((id, from, name) =>
      Effect.tryPromise({
        try: async () => {
          directory(id).create({ intermediates: true, idempotent: true });

          const target = file(id, name);

          await new File(from).copy(target, { overwrite: true });

          return target.size;
        },
        catch: (cause) => new BookFilesError({ cause }),
      }),
    ),
    size: Effect.fn("BookFiles.size")((id, name) =>
      Effect.try({
        try: () => file(id, name).size,
        catch: (cause) => new BookFilesError({ cause }),
      }),
    ),
    path: (id, name) => toPath(name === undefined ? directory(id).uri : file(id, name).uri),
    uri: (id, name) => file(id, name).uri,
    remove: (id, names) =>
      Effect.forEach(names, (name) =>
        quietly(() => {
          const target = file(id, name);

          if (target.exists) target.delete();
        }),
      ).pipe(Effect.asVoid),
    removeAll: (id) =>
      quietly(() => {
        if (directory(id).exists) directory(id).delete();
      }),
    stored: Effect.sync(() =>
      root.exists
        ? root.list().flatMap((entry) => (entry instanceof Directory ? [entry.name] : []))
        : [],
    ),
  });
});

export const layer = Layer.effect(BookFiles, make);
