import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiError from "effect/http-api/HttpApiError";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity";

// The Kindle's ts.sh parses "<id>\t<name>\n" listing lines and writes <name> to disk.
export const ItemName = Schema.String.check(Schema.isPattern(/^[^\t\n\r/]+$/)).pipe(
  Schema.brand("ItemName"),
);

export type ItemName = typeof ItemName.Type;

export const ItemKey = Schema.String.check(Schema.isPattern(/^items\//)).pipe(
  Schema.brand("ItemKey"),
);

export type ItemKey = typeof ItemKey.Type;

// On the wire an item is base64url of its R2 key, so the Kindle's shell never URL-encodes.
export const ItemId = Schema.StringFromBase64Url.pipe(Schema.decodeTo(ItemKey));

// Zero-padded upload time first, so R2's lexical listing is upload order. The app uploads a
// book's thumbnail before the book, and the Kindle must install them in that order.
export const itemKey = (uploadedAtMillis: number, name: ItemName) =>
  ItemKey.make(`items/${String(uploadedAtMillis).padStart(15, "0")}/${name}`);

export const nameOfKey = (key: ItemKey) => key.slice(key.lastIndexOf("/") + 1);

const Text = Schema.String.pipe(HttpApiSchema.asText());

export class AppAuth extends HttpApiMiddleware.Service<AppAuth>()("AppAuth", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.bearer },
}) {}

export class KindleAuth extends HttpApiMiddleware.Service<KindleAuth>()("KindleAuth", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.bearer },
}) {}

// Accepts either token. HttpApi registers a path once, so an endpoint both sides call lives here.
export class EitherAuth extends HttpApiMiddleware.Service<EitherAuth>()("EitherAuth", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.bearer },
}) {}

/** When the Kindle last listed the mailbox, and the items it has not removed yet. */
export const MailboxStatus = Schema.Struct({
  checkedInAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
  waiting: Schema.Array(ItemId),
});

export type MailboxStatus = typeof MailboxStatus.Type;

export class HealthGroup extends HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("health", "/health", { success: Text }),
) {}

/** The phone app's side: queue books for the Kindle, follow them, read its diagnostics. */
export class AppGroup extends HttpApiGroup.make("app")
  .add(HttpApiEndpoint.get("status", "/status", { success: MailboxStatus }))
  .add(
    HttpApiEndpoint.put("upload", "/items/:name", {
      params: { name: ItemName },
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: ItemId.pipe(HttpApiSchema.asText(), HttpApiSchema.status(201)),
      error: HttpApiError.BadRequest,
    }),
  )
  .add(
    HttpApiEndpoint.get("report", "/reports/:name", {
      params: { name: ItemName },
      success: Text,
      error: HttpApiError.NotFound,
    }),
  )
  .middleware(AppAuth) {}

/** The Kindle's side, driven by curl in ts.sh on every wake. */
export class KindleGroup extends HttpApiGroup.make("kindle")
  .add(HttpApiEndpoint.get("list", "/items/", { success: Text }))
  .add(
    HttpApiEndpoint.get("download", "/items/:id", {
      params: { id: ItemId },
      success: HttpApiSchema.StreamUint8Array(),
      error: HttpApiError.NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.put("putReport", "/reports/:name", {
      params: { name: ItemName },
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    }),
  )
  .middleware(KindleAuth) {}

/** The Kindle removes an item once it has installed it. The app removes one to cancel sending. */
export class SharedGroup extends HttpApiGroup.make("shared")
  .add(HttpApiEndpoint.delete("remove", "/items/:id", { params: { id: ItemId } }))
  .middleware(EitherAuth) {}

export class MailboxApi extends HttpApi.make("MailboxApi")
  .add(HealthGroup)
  .add(AppGroup)
  .add(KindleGroup)
  .add(SharedGroup) {}
