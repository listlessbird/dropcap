import * as Network from "expo-network";
import { AppState } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { booksState } from "../../state/books";
import { nowAtom } from "../../state/clock";

const refresh = () => {
  appAtomRegistry.refresh(nowAtom);
  appAtomRegistry.refresh(booksState.kindleStatusAtom);
};

/**
 * Asks the mailbox again when the app returns to the foreground or the network comes back, which
 * also follows books to the Kindle and retries uploads that failed offline. Holding the status atom
 * for the app's lifetime lets that retry run with no screen open, such as after a share. Nothing polls.
 */
export function installKindleRefresh(): () => void {
  const release = appAtomRegistry.mount(booksState.kindleStatusAtom);

  const foreground = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });

  let reachable: boolean | undefined;

  const network = Network.addNetworkStateListener(({ isConnected, isInternetReachable }) => {
    const now = isInternetReachable ?? isConnected ?? false;

    if (now && reachable !== true) refresh();

    reachable = now;
  });

  return () => {
    release();
    foreground.remove();
    network.remove();
  };
}
