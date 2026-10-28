import { MailboxApi, type ItemKey, type MailboxStatus } from "@kindle-drop/worker/Api";
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
 * not be reached, or it answered with something that is not a Kindle Drop mailbox.
 */
export class MailboxError extends Schema.TaggedError<MailboxError>()("MailboxError", {
  reason: Schema.Literals(["unauthorized", "unreachable", "unexpected"]),
  cause: Schema.Defect(),
}) {}

// A phone on a captive or flaky network can hold a request open for minutes.
const REQUEST_TIMEOUT = Duration.seconds(15);

/** The mailbox Worker, through a client derived from apps/worker/src/Api.ts. */
export class MailboxClient extends Context.Service<
  MailboxClient,
  {
    readonly status: (connection: Connection) => Effect.Effect<MailboxStatus, MailboxError>;
    /** Removes a waiting item so the Kindle never downloads it. */
    readonly cancel: (connection: Connection, id: ItemKey) => Effect.Effect<void, MailboxError>;
  }
>()("@kindle-drop/mobile/lib/MailboxClient") {}

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
  });
});

export const layer = Layer.effect(MailboxClient, make).pipe(Layer.provide(FetchHttpClient.layer));
