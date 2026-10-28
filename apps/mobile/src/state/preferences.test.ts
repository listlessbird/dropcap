import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry } from "effect/reactivity";

import * as MobilePreferences from "../persistence/mobile-preferences";
import { createPreferencesState } from "./preferences";

const saveError = new MobilePreferences.MobilePreferencesError({ operation: "save", cause: null });

const mountState = <E>(layer: Layer.Layer<MobilePreferences.MobilePreferencesStore, E>) => {
  const state = createPreferencesState(Atom.runtime(layer));
  const registry = AtomRegistry.make();

  registry.mount(state.preferencesAtom);
  registry.mount(state.updatePreferencesAtom);

  const preferences = AtomRegistry.getResult(registry, state.preferencesAtom, {
    suspendOnWaiting: true,
  });

  const settled = Effect.exit(
    AtomRegistry.getResult(registry, state.updatePreferencesAtom, { suspendOnWaiting: true }),
  );

  return { state, registry, preferences, settled };
};

const storeLayer = (savePatch: MobilePreferences.MobilePreferencesStore["Service"]["savePatch"]) =>
  Layer.succeed(
    MobilePreferences.MobilePreferencesStore,
    MobilePreferences.MobilePreferencesStore.of({
      load: Effect.succeed({ themeMode: "light" }),
      savePatch,
    }),
  );

describe("preferences state", () => {
  it.effect("shows a write before storage confirms it", () =>
    Effect.gen(function* () {
      const confirm = yield* Deferred.make<void>();

      const { state, registry, preferences, settled } = mountState(
        storeLayer((patch) => Deferred.await(confirm).pipe(Effect.as({ ...patch }))),
      );

      assert.deepStrictEqual(yield* preferences, { themeMode: "light" });

      registry.set(state.updatePreferencesAtom, { themeMode: "dark" });

      assert.deepStrictEqual(yield* preferences, { themeMode: "dark" });

      yield* Deferred.succeed(confirm, undefined);

      assert.isTrue(Exit.isSuccess(yield* settled));
      assert.deepStrictEqual(yield* preferences, { themeMode: "dark" });
    }),
  );

  it.effect("rolls back a write that storage rejects", () =>
    Effect.gen(function* () {
      const { state, registry, preferences, settled } = mountState(
        storeLayer(() => Effect.fail(saveError)),
      );

      yield* preferences;
      registry.set(state.updatePreferencesAtom, { themeMode: "dark" });

      assert.isTrue(Exit.isFailure(yield* settled));
      assert.deepStrictEqual(yield* preferences, { themeMode: "light" });
    }),
  );

  it.effect("runs on defaults when storage cannot open", () =>
    Effect.gen(function* () {
      const { preferences } = mountState(
        Layer.effect(MobilePreferences.MobilePreferencesStore, Effect.fail(saveError)),
      );

      assert.deepStrictEqual(yield* preferences, {});
    }),
  );
});
