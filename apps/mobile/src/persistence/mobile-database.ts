import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const DATABASE_NAME = "kindle-drop.db";

// Append only. A database at user_version N runs every migration after index N - 1 in one
// exclusive transaction, so a crash mid-migration leaves the previous version intact.
const MIGRATIONS: ReadonlyArray<string> = [
  `CREATE TABLE client_preferences (
     singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
     payload TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
];

const MobileDatabaseOperation = Schema.Literals([
  "open",
  "migrate",
  "load-preferences",
  "save-preferences",
]);

export class MobileDatabaseError extends Schema.TaggedError<MobileDatabaseError>()(
  "MobileDatabaseError",
  {
    operation: MobileDatabaseOperation,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Mobile database operation failed: ${this.operation}.`;
  }
}

const databaseError = (operation: typeof MobileDatabaseOperation.Type) => (cause: unknown) =>
  new MobileDatabaseError({ operation, cause });

export interface StoredPreferencesJson {
  readonly payload: string;
  readonly updatedAt: number;
}

export class MobileDatabase extends Context.Service<
  MobileDatabase,
  {
    readonly loadPreferencesJson: Effect.Effect<
      Option.Option<StoredPreferencesJson>,
      MobileDatabaseError
    >;
    readonly savePreferencesJson: (
      payload: string,
      updatedAt: number,
    ) => Effect.Effect<void, MobileDatabaseError>;
  }
>()("@kindle-drop/mobile/persistence/MobileDatabase") {}

export const make = Effect.gen(function* () {
  const database = yield* Effect.acquireRelease(
    Effect.tryPromise({
      // Imported lazily so Node tests can load this module without the native binding.
      try: async () => (await import("expo-sqlite")).openDatabaseAsync(DATABASE_NAME),
      catch: databaseError("open"),
    }),
    (open) => Effect.promise(() => open.closeAsync()).pipe(Effect.ignore),
  );

  yield* Effect.tryPromise({
    try: async () => {
      await database.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

      const schema = await database.getFirstAsync<{ readonly user_version: number }>(
        "PRAGMA user_version",
      );

      const pending = MIGRATIONS.slice(schema?.user_version ?? 0);

      if (pending.length === 0) return;

      await database.withExclusiveTransactionAsync(async (transaction) => {
        for (const migration of pending) await transaction.execAsync(migration);

        await transaction.execAsync(`PRAGMA user_version = ${MIGRATIONS.length};`);
      });
    },
    catch: databaseError("migrate"),
  });

  return MobileDatabase.of({
    loadPreferencesJson: Effect.tryPromise({
      try: () =>
        database.getFirstAsync<StoredPreferencesJson>(
          "SELECT payload, updated_at AS updatedAt FROM client_preferences WHERE singleton = 1",
        ),
      catch: databaseError("load-preferences"),
    }).pipe(Effect.map(Option.fromNullishOr)),
    savePreferencesJson: Effect.fn("MobileDatabase.savePreferencesJson")((payload, updatedAt) =>
      Effect.tryPromise({
        try: () =>
          database.runAsync(
            `INSERT INTO client_preferences (singleton, payload, updated_at) VALUES (1, ?, ?)
             ON CONFLICT (singleton) DO UPDATE SET
               payload = excluded.payload,
               updated_at = excluded.updated_at`,
            payload,
            updatedAt,
          ),
        catch: databaseError("save-preferences"),
      }).pipe(Effect.asVoid),
    ),
  });
});

export const layer = Layer.effect(MobileDatabase, make);
