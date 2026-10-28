import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { Connection, PairingLink } from "../lib/connection";
import { MailboxClient } from "../lib/mailboxClient";
import * as Runtime from "../lib/runtime";
import { ConnectionStore } from "../persistence/connection-store";

export class PairingCodeUnreadable extends Schema.TaggedError<PairingCodeUnreadable>()(
  "PairingCodeUnreadable",
  {},
) {}

export class ServerAddressInvalid extends Schema.TaggedError<ServerAddressInvalid>()(
  "ServerAddressInvalid",
  {},
) {}

const decodePairingLink = Schema.decodeUnknownEffect(PairingLink);
const decodeConnection = Schema.decodeUnknownEffect(Connection);

/**
 * The paired mailbox and the ways to change it. A connection is saved only after the mailbox
 * accepts its key, so the app never holds one that cannot reach the Kindle.
 */
export function createConnectionState<E>(
  runtime: Atom.AtomRuntime<ConnectionStore | MailboxClient, E>,
) {
  const connectionAtom = runtime
    .atom(
      ConnectionStore.use((store) => store.load).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not load the Kindle connection.", error).pipe(
            Effect.as(Option.none<Connection>()),
          ),
        ),
      ),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("connection"));

  const connect = Effect.fnUntraced(function* (connection: Connection, get: Atom.FnContext) {
    yield* MailboxClient.use((client) => client.status(connection));
    yield* ConnectionStore.use((store) => store.save(connection));
    get.refresh(connectionAtom);
  });

  /** Pairs from a scanned code or a `<scheme>://connect` link. */
  const pairWithCodeAtom = runtime
    .fn((link: string, get) =>
      decodePairingLink(link).pipe(
        Effect.mapError(() => new PairingCodeUnreadable()),
        Effect.flatMap((connection) => connect(connection, get)),
      ),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("connection:pair-with-code"));

  /** Pairs from the "Enter details" form. */
  const pairWithDetailsAtom = runtime
    .fn((details: { readonly server: string; readonly key: string }, get) =>
      decodeConnection(details).pipe(
        Effect.mapError(() => new ServerAddressInvalid()),
        Effect.flatMap((connection) => connect(connection, get)),
      ),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("connection:pair-with-details"));

  // Clears the last attempt too, so Connect opens without an error from before pairing.
  const disconnectAtom = runtime
    .fn((_: void, get) =>
      ConnectionStore.use((store) => store.clear).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            get.set(pairWithCodeAtom, Atom.Reset);
            get.set(pairWithDetailsAtom, Atom.Reset);
            get.refresh(connectionAtom);
          }),
        ),
      ),
    )
    .pipe(Atom.withLabel("connection:disconnect"));

  /** The mailbox's view of the Kindle, and when this phone asked. Refresh it to ask again. */
  const kindleStatusAtom = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const connection = yield* Effect.fromOption(yield* get.result(connectionAtom));
        const status = yield* MailboxClient.use((client) => client.status(connection));

        return { ...status, askedAt: yield* DateTime.now };
      }),
    )
    .pipe(Atom.withLabel("connection:kindle-status"));

  return {
    connectionAtom,
    pairWithCodeAtom,
    pairWithDetailsAtom,
    disconnectAtom,
    kindleStatusAtom,
  } as const;
}

const connectionState = createConnectionState(Atom.runtime(Runtime.layer));

export const connectionAtom = connectionState.connectionAtom;
export const pairWithCodeAtom = connectionState.pairWithCodeAtom;
export const pairWithDetailsAtom = connectionState.pairWithDetailsAtom;
export const disconnectAtom = connectionState.disconnectAtom;
export const kindleStatusAtom = connectionState.kindleStatusAtom;
