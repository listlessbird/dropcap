import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";

/** When the screen last looked, for relative times. Refresh it when the screen gains focus. */
export const nowAtom = Atom.make(() => DateTime.nowUnsafe()).pipe(Atom.withLabel("now"));
