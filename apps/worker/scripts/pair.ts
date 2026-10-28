// Prints the pairing code the phone app scans: a QR code of
// <scheme>://connect?server=<url>&key=<APP_TOKEN>, and the same link as text.
// `pnpm vp run --filter @kindle-drop/worker pair` pairs with prod. For a local Worker and the dev
// client: pair --server http://10.0.2.2:1337 --key dev-app --scheme kindledrop-dev
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { renderUnicodeCompact } from "uqr";

const PROD_SERVER = "https://kindle-mailbox.listlessbird.workers.dev";

// The same file alchemy.run.ts deploys prod's secrets from.
const secretsFile = `${process.env.HOME}/.config/kindle-mailbox/secrets.env`;

const pair = Command.make(
  "pair",
  {
    server: Flag.String("server").pipe(
      Flag.withSchema(Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s/?#]+\/?$/))),
      Flag.withDefault(PROD_SERVER),
      Flag.withDescription("The Worker's address, without a path."),
    ),
    key: Flag.Redacted("key").pipe(
      Flag.withFallbackConfig(Config.Redacted("APP_TOKEN")),
      Flag.withDescription(`The app token. Defaults to APP_TOKEN in ${secretsFile}.`),
    ),
    scheme: Flag.String("scheme").pipe(
      Flag.withDefault("kindledrop"),
      Flag.withDescription("The app's link scheme. The dev client's is kindledrop-dev."),
    ),
  },
  ({ server, key, scheme }) => {
    const link = `${scheme}://connect?server=${encodeURIComponent(server.replace(/\/$/, ""))}&key=${encodeURIComponent(Redacted.value(key))}`;

    return Console.log(`${renderUnicodeCompact(link, { border: 2 })}\n\n${link}`);
  },
).pipe(Command.withDescription("Print the pairing code for the Kindle Drop app."));

const secrets = ConfigProvider.layer(
  ConfigProvider.fromDotEnv({ path: secretsFile }).pipe(
    Effect.orElseSucceed(() => ConfigProvider.fromUnknown({})),
  ),
);

Command.run(pair, { version: "0.0.0" }).pipe(
  Effect.provide(Layer.provideMerge(secrets, NodeServices.layer)),
  NodeRuntime.runMain,
);
