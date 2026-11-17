import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";

const storeWith = (initial: Option.Option<string>) =>
  Effect.gen(function* () {
    const row = yield* Ref.make(initial);

    const database = Layer.succeed(
      MobileDatabase.MobileDatabase,
      MobileDatabase.MobileDatabase.of({
        loadPreferencesJson: Ref.get(row).pipe(
          Effect.map(Option.map((payload) => ({ payload, updatedAt: 0 }))),
        ),
        savePreferencesJson: (payload) => Ref.set(row, Option.some(payload)),
        loadBooksJson: Effect.succeed([]),
        saveBookJson: () => Effect.void,
        deleteBook: () => Effect.void,
      }),
    );

    const store = yield* MobilePreferences.MobilePreferencesStore.pipe(
      Effect.provide(MobilePreferences.layer.pipe(Layer.provide(database))),
    );

    return { store, row };
  });

describe("MobilePreferencesStore", () => {
  it.effect("loads empty preferences when nothing is stored", () =>
    Effect.gen(function* () {
      const { store } = yield* storeWith(Option.none());

      assert.deepStrictEqual(yield* store.load, {});
    }),
  );

  it.effect("drops an invalid stored value instead of failing the load", () =>
    Effect.gen(function* () {
      const { store } = yield* storeWith(Option.some(`{"themeMode":"neon"}`));

      assert.deepStrictEqual(yield* store.load, {});
    }),
  );

  it.effect("treats unreadable JSON as empty", () =>
    Effect.gen(function* () {
      const { store } = yield* storeWith(Option.some("{not json"));

      assert.deepStrictEqual(yield* store.load, {});
    }),
  );

  it.effect("persists a patch that the next load returns", () =>
    Effect.gen(function* () {
      const { store, row } = yield* storeWith(Option.none());

      assert.deepStrictEqual(yield* store.savePatch({ themeMode: "dark" }), { themeMode: "dark" });
      assert.deepStrictEqual(yield* store.load, { themeMode: "dark" });
      assert.deepStrictEqual(yield* Ref.get(row), Option.some(`{"themeMode":"dark"}`));
    }),
  );
});
