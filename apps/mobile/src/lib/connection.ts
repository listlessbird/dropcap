import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

const stripTrailingSlashes = SchemaGetter.transform((address: string) =>
  address.replace(/\/+$/, ""),
);

/** The Worker's origin, such as `https://kindle-mailbox.example.workers.dev`. */
export const ServerAddress = Schema.Trim.pipe(
  Schema.decodeTo(
    Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s/?#]+$/)).pipe(
      Schema.brand("ServerAddress"),
    ),
    { decode: stripTrailingSlashes, encode: SchemaGetter.passthrough() },
  ),
);

/** The Worker's APP_TOKEN. */
export const AccessKey = Schema.RedactedFromValue(
  Schema.Trim.pipe(Schema.check(Schema.isNonEmpty())),
);

/** The mailbox the app sends to. Its JSON form, key included, lives only in secure storage. */
export const Connection = Schema.Struct({ server: ServerAddress, key: AccessKey });

export type Connection = typeof Connection.Type;

const uriComponent = <S extends Schema.Top>(schema: S) =>
  Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.decodeUriComponent(),
      encode: SchemaGetter.encodeUriComponent(),
    }),
    Schema.decodeTo(schema),
  );

const PAIRING_LINK = /^[a-z][a-z\d+.-]*:\/\/connect\/?\?/i;

/** Whether a link opened the app to pair, whether or not its details are valid. */
export const isPairingLink = (link: string) => PAIRING_LINK.test(link);

/**
 * `<scheme>://connect?server=<address>&key=<key>`, as `pnpm vp run --filter @dropcap/worker pair`
 * prints it. Any scheme decodes, so one code pairs the production, preview and dev apps.
 */
export const PairingLink = Schema.String.check(Schema.isPattern(PAIRING_LINK)).pipe(
  Schema.decodeTo(Schema.Record(Schema.String, Schema.String), {
    decode: SchemaGetter.transform((link: string) => link.replace(PAIRING_LINK, "")).pipe(
      SchemaGetter.compose(SchemaGetter.splitKeyValue({ separator: "&" })),
    ),
    encode: SchemaGetter.joinKeyValue({ separator: "&" }).pipe(
      SchemaGetter.map((query) => `kindledrop://connect?${query}`),
    ),
  }),
  Schema.decodeTo(
    Schema.Struct({ server: uriComponent(ServerAddress), key: uriComponent(AccessKey) }),
  ),
);
