import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Equivalence from "effect/Equivalence";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiError from "effect/http-api/HttpApiError";
import { AppAuth, ItemId, KindleAuth, MailboxApi, nameOfKey } from "./Api.ts";
import { Mailbox, MailboxR2 } from "./Mailbox.ts";

// HttpPlatform.layer needs a FileSystem, which a Worker isolate does not have.
const HttpPlatformWeb = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: Effect.fn("HttpPlatform.fileResponse")(function () {
    return Effect.die("The mailbox does not serve files from disk");
  }),
  fileWebResponse: Effect.fn("HttpPlatform.fileWebResponse")(function () {
    return Effect.die("The mailbox does not serve files from disk");
  }),
});

const encodeItemId = Schema.encodeSync(ItemId);

const sameToken = Redacted.makeEquivalence(Equivalence.String);

const requireBearer = (token: Redacted.Redacted<string>) => ({
  bearer: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    { credential }: { readonly credential: Redacted.Redacted<string> },
  ) => (sameToken(credential, token) ? effect : Effect.fail(new HttpApiError.Unauthorized({}))),
});

const orNotFound = Effect.fromOption(() => new HttpApiError.NotFound({}));

// The Worker hands Effect its native Request, so this is the original body stream, unbuffered.
const webBody = (request: HttpServerRequest.HttpServerRequest) =>
  HttpServerRequest.toWeb(request).pipe(
    Effect.map(({ body }) => Option.fromNullishOr(body)),
    Effect.orDie,
  );

/**
 * The mailbox between the phone app and the Kindle. The app uploads with APP_TOKEN, and the Kindle
 * lists, downloads, and deletes with KINDLE_TOKEN. Each token works only for its own role.
 */
export default Cloudflare.Worker(
  "Mailbox",
  { name: "kindle-mailbox", main: import.meta.url, compatibility: { date: "2026-09-25" } },
  Effect.gen(function* () {
    const mailbox = yield* Mailbox;
    const appToken = yield* Config.Redacted("APP_TOKEN");
    const kindleToken = yield* Config.Redacted("KINDLE_TOKEN");

    const health = HttpApiBuilder.group(MailboxApi, "health", (handlers) =>
      handlers.handle("health", () => Effect.succeed("ok\n")),
    );

    const app = HttpApiBuilder.group(MailboxApi, "app", (handlers) =>
      handlers
        .handleRaw("upload", ({ params, request }) =>
          webBody(request).pipe(
            Effect.flatMap(Effect.fromOption(() => new HttpApiError.BadRequest({}))),
            Effect.flatMap((body) => mailbox.upload(params.name, body)),
          ),
        )
        .handle("report", ({ params }) =>
          Effect.flatMap(mailbox.getReport(params.name), orNotFound),
        ),
    );

    const kindle = HttpApiBuilder.group(MailboxApi, "kindle", (handlers) =>
      handlers
        .handle("list", () =>
          Effect.map(mailbox.list, (keys) =>
            keys.map((key) => `${encodeItemId(key)}\t${nameOfKey(key)}\n`).join(""),
          ),
        )
        .handle("download", ({ params }) => Effect.flatMap(mailbox.download(params.id), orNotFound))
        .handle("remove", ({ params }) => mailbox.remove(params.id))
        .handleRaw("putReport", ({ params, request }) =>
          Effect.flatMap(webBody(request), (body) => mailbox.putReport(params.name, body)),
        ),
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        HttpApiBuilder.layer(MailboxApi).pipe(
          Layer.provide([health, app, kindle]),
          Layer.provide([
            Layer.succeed(AppAuth, requireBearer(appToken)),
            Layer.succeed(KindleAuth, requireBearer(kindleToken)),
          ]),
          Layer.provide([Etag.layer, HttpPlatformWeb, Path.layer]),
        ),
      ),
    };
  }).pipe(Effect.provide(MailboxR2)),
);
