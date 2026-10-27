import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { THEME_IDS } from "../lib/theme";
import * as MobileDatabase from "./mobile-database";

// An invalid stored value drops only its own key, so one bad field never resets the rest.
const preference = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

export const ThemeMode = Schema.Literals(["system", "light", "dark"]);

export type ThemeMode = typeof ThemeMode.Type;

export const Preferences = Schema.Struct({
  themeMode: preference(ThemeMode),
  themeId: preference(Schema.Literals(THEME_IDS)),
});

export type Preferences = typeof Preferences.Type;

const PreferencesJson = Schema.fromJsonString(Preferences);
const decodePreferencesJson = Schema.decodeUnknownEffect(PreferencesJson);
const encodePreferencesJson = Schema.encodeEffect(PreferencesJson);

export class MobilePreferencesError extends Schema.TaggedError<MobilePreferencesError>()(
  "MobilePreferencesError",
  {
    operation: Schema.Literals(["load", "save"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not ${this.operation} mobile preferences.`;
  }
}

export class MobilePreferencesStore extends Context.Service<
  MobilePreferencesStore,
  {
    readonly load: Effect.Effect<Preferences, MobilePreferencesError>;
    /** Merges `patch` into the stored preferences and returns the saved result. */
    readonly savePatch: (patch: Preferences) => Effect.Effect<Preferences, MobilePreferencesError>;
  }
>()("@kindle-drop/mobile/persistence/MobilePreferencesStore") {}

export const make = Effect.gen(function* () {
  const database = yield* MobileDatabase.MobileDatabase;
  // Saves read, merge, and write one shared row; serializing them keeps concurrent patches.
  const writes = yield* Semaphore.make(1);

  const load = database.loadPreferencesJson.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<Preferences>({}),
        // Unreadable JSON is treated as empty rather than blocking every later save.
        onSome: ({ payload }) =>
          decodePreferencesJson(payload).pipe(Effect.orElseSucceed((): Preferences => ({}))),
      }),
    ),
    Effect.mapError((cause) => new MobilePreferencesError({ operation: "load", cause })),
  );

  const savePatch = Effect.fn("MobilePreferencesStore.savePatch")(function* (patch: Preferences) {
    const next = { ...(yield* load), ...patch };

    const payload = yield* encodePreferencesJson(next).pipe(
      Effect.mapError((cause) => new MobilePreferencesError({ operation: "save", cause })),
    );

    yield* database
      .savePreferencesJson(payload, yield* Clock.currentTimeMillis)
      .pipe(Effect.mapError((cause) => new MobilePreferencesError({ operation: "save", cause })));

    return next;
  }, writes.withPermit);

  return MobilePreferencesStore.of({ load, savePatch });
});

export const layer = Layer.effect(MobilePreferencesStore, make);
