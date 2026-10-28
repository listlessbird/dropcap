import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Secrets from "alchemy/Secrets";
import * as State from "alchemy/State";
import * as Effect from "effect/Effect";
import Mailbox from "./src/Worker.ts";

// The prod APP_TOKEN and KINDLE_TOKEN; other stages read them from the environment. The Kindle
// keeps its own copy, so rotating KINDLE_TOKEN also means updating
// /mnt/us/extensions/tailscale/mailbox.token on the device.
const secretsFile = `${process.env.HOME}/.config/kindle-mailbox/secrets.env`;

export default Alchemy.Stack(
  "KindleMailbox",
  {
    providers: Cloudflare.providers(),
    // One deployer on one laptop. adopt(true) recovers the resources if .alchemy/ is ever lost.
    state: State.localState(),
    secrets: [
      Secrets.ProcessEnv(),
      Secrets.DotEnv(({ stage }) => ({ path: stage === "prod" ? [secretsFile] : [] })),
    ],
  },
  Effect.gen(function* () {
    const mailbox = yield* Mailbox;

    return { url: mailbox.url };
  }).pipe(adopt(true)),
);
