import {
  ItemId,
  MailboxApi,
  type Command,
  type CommandId,
  type ItemKey,
  type ItemName,
  type MailboxStatus,
} from "@dropcap/worker/Api";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import type * as HttpApiError from "effect/http-api/HttpApiError";

import type { Connection } from "./connection";

export type { ItemKey, MailboxStatus };

/**
 * Why a mailbox request failed, in the terms the UI explains: the key was refused, the server could
 * not be reached, or it answered with something that is not a Dropcap mailbox.
 */
export const MailboxErrorReason = Schema.Literals(["unauthorized", "unreachable", "unexpected"]);

export type MailboxErrorReason = typeof MailboxErrorReason.Type;

export class MailboxError extends Schema.TaggedError<MailboxError>()("MailboxError", {
  reason: MailboxErrorReason,
  cause: Schema.Defect(),
}) {}

// A phone on a captive or flaky network can hold a request open for minutes.
const REQUEST_TIMEOUT = Duration.seconds(15);

const decodeItemId = Schema.decodeUnknownEffect(ItemId);

/** The mailbox Worker, through a client derived from apps/worker/src/Api.ts. */
export class MailboxClient extends Context.Service<
  MailboxClient,
  {
    readonly status: (connection: Connection) => Effect.Effect<MailboxStatus, MailboxError>;
    /** Removes a waiting item so the Kindle never downloads it. */
    readonly cancel: (connection: Connection, id: ItemKey) => Effect.Effect<void, MailboxError>;
    /** Queues a command the Kindle runs the next time it wakes. */
    readonly queue: (
      connection: Connection,
      command: Command,
    ) => Effect.Effect<CommandId, MailboxError>;
    /** Cancels a command the Kindle has not run yet, or clears one it has. */
    readonly dismiss: (connection: Connection, id: CommandId) => Effect.Effect<void, MailboxError>;
    /**
     * Streams the file at `uri` into the mailbox as `name` and returns its key. `onProgress` gets
     * the fraction sent so far. Interrupting aborts the request.
     */
    readonly upload: (
      connection: Connection,
      name: ItemName,
      uri: string,
      onProgress: (fraction: number) => void,
    ) => Effect.Effect<ItemKey, MailboxError>;
  }
>()("@dropcap/mobile/lib/MailboxClient") {}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const clientFor = (connection: Connection) =>
    HttpApiClient.make(MailboxApi, {
      baseUrl: connection.server,
      transformClient: HttpClient.mapRequest(
        HttpClientRequest.bearerToken(Redacted.value(connection.key)),
      ),
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));

  const request = <A>(
    effect: Effect.Effect<
      A,
      HttpApiError.Unauthorized | HttpClientError.HttpClientError | Schema.SchemaError
    >,
  ) =>
    effect.pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.catchTags({
        Unauthorized: (cause) => Effect.fail(new MailboxError({ reason: "unauthorized", cause })),
        TimeoutError: (cause) => Effect.fail(new MailboxError({ reason: "unreachable", cause })),
        HttpClientError: (cause) =>
          Effect.fail(
            new MailboxError({
              reason: Predicate.isTagged(cause.reason, "TransportError")
                ? "unreachable"
                : "unexpected",
              cause,
            }),
          ),
        SchemaError: (cause) => Effect.fail(new MailboxError({ reason: "unexpected", cause })),
      }),
    );

  return MailboxClient.of({
    status: Effect.fn("MailboxClient.status")((connection) =>
      request(Effect.flatMap(clientFor(connection), (client) => client.app.status())),
    ),
    cancel: Effect.fn("MailboxClient.cancel")((connection, id) =>
      request(
        Effect.flatMap(clientFor(connection), (client) => client.shared.remove({ params: { id } })),
      ),
    ),
    queue: Effect.fn("MailboxClient.queue")((connection, command) =>
      request(
        Effect.flatMap(clientFor(connection), (client) =>
          client.app.queue({ payload: { command } }),
        ),
      ),
    ),
    dismiss: Effect.fn("MailboxClient.dismiss")((connection, id) =>
      request(
        Effect.flatMap(clientFor(connection), (client) => client.app.dismiss({ params: { id } })),
      ),
    ),
    // React Native's fetch reports no upload progress and would hold the whole book in memory.
    upload: Effect.fn("MailboxClient.upload")(function* (connection, name, uri, onProgress) {
      const { File } = yield* Effect.promise(() => import("expo-file-system"));

      const url = HttpApiClient.urlBuilder(MailboxApi, { baseUrl: connection.server }).app.upload({
        params: { name },
      });

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          new File(uri).upload(url, {
            httpMethod: "PUT",
            headers: { Authorization: `Bearer ${Redacted.value(connection.key)}` },
            mimeType: "application/octet-stream",
            onProgress: ({ bytesSent, totalBytes }) =>
              onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0),
            signal,
          }),
        catch: (cause) => new MailboxError({ reason: "unreachable", cause }),
      });

      if (response.status === 401) {
        return yield* new MailboxError({ reason: "unauthorized", cause: response.body });
      }

      if (response.status !== 201) {
        return yield* new MailboxError({ reason: "unexpected", cause: response.body });
      }

      return yield* decodeItemId(response.body).pipe(
        Effect.mapError((cause) => new MailboxError({ reason: "unexpected", cause })),
      );
    }),
  });
});

export const layer = Layer.effect(MailboxClient, make).pipe(Layer.provide(FetchHttpClient.layer));
