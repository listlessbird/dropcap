import * as Match from "effect/Match";
import { AsyncResult, type Atom } from "effect/reactivity";

import type { MailboxError } from "../../lib/mailboxClient";
import type { pairWithCodeAtom, pairWithDetailsAtom } from "../../state/connection";

/** Where the connection came from: a scanned code or link, or the "Enter details" form. */
export type PairingSource = "code" | "details";

const COULD_NOT_CONNECT = "Couldn't connect. Try again in a few minutes.";

const COULD_NOT_SAVE = "Couldn't save the connection. Try again.";

const MAILBOX_COPY = {
  code: {
    unauthorized: "This pairing code no longer works. Create a new one on your computer.",
    unreachable: "Couldn't connect. Check your connection and try again.",
    unexpected: COULD_NOT_CONNECT,
  },
  details: {
    unauthorized: "This access key doesn't work. Check it on your computer.",
    unreachable: "Couldn't reach this server. Check the address and try again.",
    unexpected: "Couldn't reach this server. Check the address and try again.",
  },
} satisfies Record<PairingSource, Record<MailboxError["reason"], string>>;

/** The copy for a failed pairing attempt, or undefined while it has not failed. */
export function pairingErrorMessage(
  result: AsyncResult.AsyncResult<
    void,
    Atom.Failure<typeof pairWithCodeAtom> | Atom.Failure<typeof pairWithDetailsAtom>
  >,
  source: PairingSource,
): string | undefined {
  return AsyncResult.matchWithError(result, {
    onInitial: () => undefined,
    onSuccess: () => undefined,
    onDefect: () => COULD_NOT_CONNECT,
    onError: Match.valueTags({
      PairingCodeUnreadable: () => "This isn't a Kindle Drop pairing code.",
      ServerAddressInvalid: () => "Enter the full server address, such as https://example.com",
      MailboxError: (error) => MAILBOX_COPY[source][error.reason],
      ConnectionStoreError: () => COULD_NOT_SAVE,
      // The app's storage could not open, so nothing can be saved this launch.
      MobileDatabaseError: () => COULD_NOT_SAVE,
    }),
  });
}
