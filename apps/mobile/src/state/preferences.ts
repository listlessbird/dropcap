import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";

import * as Runtime from "../lib/runtime";
import * as MobilePreferences from "../persistence/mobile-preferences";

interface PendingPatch {
  readonly version: number;
  readonly patch: MobilePreferences.Preferences;
}

/**
 * Preferences read from storage, with in-flight writes applied on top so the UI updates at once.
 * A write that fails drops only its own patch, and later writes stay applied. If storage cannot
 * open at all, the app runs on defaults rather than waiting forever.
 */
export function createPreferencesState<E>(
  runtime: Atom.AtomRuntime<MobilePreferences.MobilePreferencesStore, E>,
) {
  const storedAtom = runtime
    .atom(
      MobilePreferences.MobilePreferencesStore.use((store) => store.load).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not load preferences.", error).pipe(
            Effect.as<MobilePreferences.Preferences>({}),
          ),
        ),
      ),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("preferences:stored"));

  const confirmedAtom = Atom.make<MobilePreferences.Preferences>({}).pipe(
    Atom.keepAlive,
    Atom.withLabel("preferences:confirmed"),
  );

  const pendingAtom = Atom.make<ReadonlyArray<PendingPatch>>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("preferences:pending"),
  );

  let nextVersion = 0;

  const preferencesAtom = Atom.make((get) => {
    const result = get(storedAtom);

    const stored = AsyncResult.isFailure(result)
      ? AsyncResult.success<MobilePreferences.Preferences>({})
      : result;

    return AsyncResult.map(stored, (stored) =>
      Object.assign({}, stored, get(confirmedAtom), ...get(pendingAtom).map(({ patch }) => patch)),
    );
  }).pipe(Atom.keepAlive, Atom.withLabel("preferences"));

  const updatePreferencesAtom = runtime
    .fn(
      (patch: MobilePreferences.Preferences, get) => {
        const version = ++nextVersion;

        const settle = () =>
          get.set(
            pendingAtom,
            get(pendingAtom).filter((pending) => pending.version !== version),
          );

        get.set(pendingAtom, [...get(pendingAtom), { version, patch }]);

        return MobilePreferences.MobilePreferencesStore.use((store) => store.savePatch(patch)).pipe(
          Effect.tap((saved) => Effect.sync(() => get.set(confirmedAtom, saved))),
          Effect.ensuring(Effect.sync(settle)),
        );
      },
      // The store serializes writes. Concurrent calls keep one field's save from interrupting another.
      { concurrent: true },
    )
    .pipe(Atom.keepAlive, Atom.withLabel("preferences:update"));

  return { preferencesAtom, updatePreferencesAtom } as const;
}

const preferencesState = createPreferencesState(Atom.runtime(Runtime.layer));

export const preferencesAtom = preferencesState.preferencesAtom;
export const updatePreferencesAtom = preferencesState.updatePreferencesAtom;
