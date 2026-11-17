import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as BookStore from "./book-store";
import * as MobileDatabase from "./mobile-database";

const storeWith = (rows: ReadonlyArray<{ readonly id: string; readonly payload: string }>) =>
  BookStore.BookStore.pipe(
    Effect.provide(
      BookStore.layer.pipe(
        Layer.provide(
          Layer.succeed(
            MobileDatabase.MobileDatabase,
            MobileDatabase.MobileDatabase.of({
              loadPreferencesJson: Effect.succeed(Option.none()),
              savePreferencesJson: () => Effect.void,
              loadBooksJson: Effect.succeed(rows),
              saveBookJson: () => Effect.void,
              deleteBook: () => Effect.void,
            }),
          ),
        ),
      ),
    ),
  );

describe("BookStore", () => {
  it.effect("reports a row it cannot read instead of hiding it", () =>
    Effect.gen(function* () {
      const store = yield* storeWith([{ id: "from-a-newer-version", payload: `{"status":{}}` }]);

      const { books, unreadable } = yield* store.list;

      assert.deepStrictEqual(books, []);
      assert.deepStrictEqual(unreadable, ["from-a-newer-version"]);
    }),
  );
});
