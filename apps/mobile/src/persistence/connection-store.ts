import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { Connection } from "../lib/connection";

// One item, so the server and its key are always written and cleared together.
const STORAGE_KEY = "connection";

const ConnectionJson = Schema.fromJsonString(Connection);
const decodeConnectionJson = Schema.decodeUnknownEffect(ConnectionJson);
const encodeConnectionJson = Schema.encodeEffect(ConnectionJson);

export class ConnectionStoreError extends Schema.TaggedError<ConnectionStoreError>()(
  "ConnectionStoreError",
  {
    operation: Schema.Literals(["load", "save", "clear"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not ${this.operation} the Kindle connection.`;
  }
}

/** The paired mailbox, kept in the Android Keystore through expo-secure-store. */
export class ConnectionStore extends Context.Service<
  ConnectionStore,
  {
    readonly load: Effect.Effect<Option.Option<Connection>, ConnectionStoreError>;
    readonly save: (connection: Connection) => Effect.Effect<void, ConnectionStoreError>;
    readonly clear: Effect.Effect<void, ConnectionStoreError>;
  }
>()("@dropcap/mobile/persistence/ConnectionStore") {}

export const make = Effect.gen(function* () {
  // Imported lazily so Node tests can load this module without the native binding.
  const SecureStore = yield* Effect.promise(() => import("expo-secure-store"));

  const storeError = (operation: ConnectionStoreError["operation"]) => (cause: unknown) =>
    new ConnectionStoreError({ operation, cause });

  return ConnectionStore.of({
    load: Effect.tryPromise({
      try: () => SecureStore.getItemAsync(STORAGE_KEY),
      catch: storeError("load"),
    }).pipe(
      Effect.flatMap((json) =>
        json === null
          ? Effect.succeedNone
          : // An unreadable connection means pairing again, not an app that cannot start.
            decodeConnectionJson(json).pipe(Effect.asSome, Effect.orElseSucceed(Option.none)),
      ),
      Effect.withSpan("ConnectionStore.load"),
    ),
    save: Effect.fn("ConnectionStore.save")(function* (connection) {
      const json = yield* encodeConnectionJson(connection).pipe(
        Effect.mapError(storeError("save")),
      );

      yield* Effect.tryPromise({
        try: () => SecureStore.setItemAsync(STORAGE_KEY, json),
        catch: storeError("save"),
      });
    }),
    clear: Effect.tryPromise({
      try: () => SecureStore.deleteItemAsync(STORAGE_KEY),
      catch: storeError("clear"),
    }).pipe(Effect.withSpan("ConnectionStore.clear")),
  });
});

export const layer = Layer.effect(ConnectionStore, make);
