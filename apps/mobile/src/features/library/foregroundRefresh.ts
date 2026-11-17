import { AppState } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { booksState } from "../../state/books";
import { nowAtom } from "../../state/clock";

/**
 * Asks the mailbox again whenever the app comes back to the foreground, which also follows books to
 * the Kindle. Refreshing touches only atoms a screen shows, and nothing runs in the background.
 */
export function installForegroundRefresh(): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;

    appAtomRegistry.refresh(nowAtom);
    appAtomRegistry.refresh(booksState.kindleStatusAtom);
  });

  return () => subscription.remove();
}
