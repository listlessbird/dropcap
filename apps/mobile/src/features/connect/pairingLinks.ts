import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";
import * as Linking from "expo-linking";

import { isPairingLink } from "../../lib/connection";
import { appAtomRegistry } from "../../state/atom-registry";
import { connectionAtom, pairWithCodeAtom } from "../../state/connection";

// The link that launched the app, then every link that reaches it while it runs.
const openedLinks = Stream.callback<string>((queue) =>
  Effect.gen(function* () {
    const initial = yield* Effect.promise(() => Linking.getInitialURL());

    if (initial !== null) Queue.offerUnsafe(queue, initial);

    const subscription = Linking.addEventListener("url", ({ url }) =>
      Queue.offerUnsafe(queue, url),
    );

    yield* Effect.addFinalizer(() => Effect.sync(() => subscription.remove()));
  }),
);

// Pairs only while disconnected: a paired app ignores codes rather than silently switching mailboxes.
const pairFromLinks = openedLinks.pipe(
  Stream.filter(isPairingLink),
  Stream.runForEach((link) =>
    AtomRegistry.getResult(appAtomRegistry, connectionAtom, { suspendOnWaiting: true }).pipe(
      Effect.flatMap((connection) =>
        Option.isNone(connection)
          ? Effect.sync(() => appAtomRegistry.set(pairWithCodeAtom, link))
          : Effect.void,
      ),
    ),
  ),
);

/** Pairs from `<scheme>://connect` links, such as the phone camera opening a pairing code. */
export function installPairingLinks(): () => void {
  const fiber = Effect.runFork(pairFromLinks);

  return () => Effect.runFork(Fiber.interrupt(fiber));
}
