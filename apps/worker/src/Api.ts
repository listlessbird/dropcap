import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
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

/** The Worker's clock when it stored the item, in epoch milliseconds. */
export const uploadedAtOfKey = (key: ItemKey) => Number(key.split("/")[1]);

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

// ts.sh deletes by path, so `.` and `..` segments are refused to keep a command inside documents/.
export const BookPath = Schema.String.check(
  Schema.isPattern(/^\/mnt\/us\/documents(?:\/(?!\.\.?(?:\/|$))[^/\t\n\r]+)+$/),
).pipe(Schema.brand("BookPath"));

export type BookPath = typeof BookPath.Type;

/** A book in the Kindle's library, as its cc.db lists it. */
export const Book = Schema.Struct({ path: BookPath, title: Schema.String });

export type Book = typeof Book.Type;

const TabSeparated = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: SchemaGetter.split({ separator: "\t" }),
    encode: SchemaGetter.transform((fields) => fields.join("\t")),
  }),
);

// One "<path>\t<title>" value per book, straight from sqlite3 on the Kindle.
const BookFromFields = TabSeparated.pipe(
  Schema.decodeTo(Schema.Tuple([Schema.String, Schema.String])),
  Schema.decodeTo(
    Book,
    SchemaTransformation.transform({
      decode: ([path, title]) => ({ path, title }),
      encode: ({ path, title }) => [path, title] as const,
    }),
  ),
);

const IntFromString = Schema.FiniteFromString.check(Schema.isInt());

/**
 * What ts.sh reports on every wake, as curl's default form encoding. It leaves out a value it
 * could not read, and the Worker rejects a malformed one.
 */
export const DeviceReport = Schema.Struct({
  battery: Schema.optionalKey(IntFromString.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  charging: Schema.optionalKey(
    Schema.FiniteFromString.pipe(Schema.decodeTo(Schema.BooleanFromBit)),
  ),
  freeKb: Schema.optionalKey(IntFromString),
  totalKb: Schema.optionalKey(IntFromString),
  firmware: Schema.optionalKey(Schema.String),
  books: Schema.Array(BookFromFields).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});

export type DeviceReport = typeof DeviceReport.Type;

/** The Kindle as of its last report. */
export const Device = DeviceReport.mapFields((fields) => ({
  ...Struct.map(fields, Schema.toType),
  reportedAt: Schema.DateTimeUtcFromString,
}));

export type Device = typeof Device.Type;

/** Something the app asks the Kindle to do on its next wake. */
export const Command = Schema.TaggedUnion({
  DeleteBook: { path: BookPath },
  Rescan: {},
});

export type Command = typeof Command.Type;

// Queue time first, like ItemKey, so the Kindle runs commands in the order they were queued.
export const CommandId = Schema.String.check(Schema.isPattern(/^\d{15}-[0-9a-f]{8}$/)).pipe(
  Schema.brand("CommandId"),
);

export type CommandId = typeof CommandId.Type;

export const commandId = (queuedAtMillis: number, random: number) =>
  CommandId.make(
    `${String(queuedAtMillis).padStart(15, "0")}-${(random >>> 0).toString(16).padStart(8, "0")}`,
  );

/** The Worker's clock when the app queued the command, in epoch milliseconds. */
export const queuedAtOfId = (id: CommandId) => Number(id.slice(0, 15));

/** How a command ended on the Kindle. ts.sh sends it as a form, and R2 keeps it as metadata. */
export const Outcome = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("ok") }),
  Schema.Struct({ outcome: Schema.Literal("failed"), message: Schema.String }),
]);

export type Outcome = typeof Outcome.Type;

/** A queued command. `outcome` is none until the Kindle runs it. */
export const QueuedCommand = Schema.Struct({
  id: CommandId,
  queuedAt: Schema.DateTimeUtcFromString,
  command: Command,
  outcome: Schema.OptionFromNullOr(Outcome),
});

export type QueuedCommand = typeof QueuedCommand.Type;

/**
 * When the Kindle last listed the mailbox, the items it has not removed yet, its last report, and
 * the commands the app queued in the last 30 days.
 */
export const MailboxStatus = Schema.Struct({
  checkedInAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
  waiting: Schema.Array(ItemId),
  device: Schema.OptionFromNullOr(Device),
  commands: Schema.Array(QueuedCommand),
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
  .add(
    // A bare union payload would make the derived client take one overload per command.
    HttpApiEndpoint.post("queue", "/commands", {
      payload: Schema.Struct({ command: Command }),
      success: CommandId.pipe(HttpApiSchema.status(201)),
    }),
  )
  // Cancels a command the Kindle has not run yet, or clears one it has.
  .add(HttpApiEndpoint.delete("dismiss", "/commands/:id", { params: { id: CommandId } }))
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
  .add(
    HttpApiEndpoint.put("putDevice", "/device", {
      payload: DeviceReport.pipe(HttpApiSchema.asFormUrlEncoded()),
    }),
  )
  // "<id>\tdelete\t<path>" or "<id>\trescan" lines, oldest first, for commands not yet run.
  .add(HttpApiEndpoint.get("commands", "/commands/", { success: Text }))
  // Unknown or already-dismissed ids succeed, so a retried acknowledgement is harmless.
  .add(
    HttpApiEndpoint.put("settle", "/commands/:id", {
      params: { id: CommandId },
      payload: Outcome.pipe(HttpApiSchema.asFormUrlEncoded()),
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
