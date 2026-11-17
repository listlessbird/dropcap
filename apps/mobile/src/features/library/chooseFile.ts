import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import * as Runtime from "../../lib/runtime";
import { Sender } from "../sending/sender";

// Android's picker greys out files whose provider reports another type, and many report EPUBs as
// application/octet-stream.
const PICKABLE = ["application/epub+zip", "application/pdf", "application/octet-stream"];

/** Opens the system file picker and sends what the user picks. None when they back out. */
export const chooseFileAtom = Atom.runtime(Runtime.layer)
  .fn(() =>
    Effect.gen(function* () {
      const picker = yield* Effect.promise(() => import("expo-document-picker"));

      const picked = yield* Effect.promise(() =>
        picker.getDocumentAsync({ type: PICKABLE, copyToCacheDirectory: true }),
      );

      const asset = picked.canceled ? undefined : picked.assets[0];

      if (asset === undefined) return Option.none();

      const file = {
        uri: asset.uri,
        name: asset.name,
        mimeType: Option.fromNullishOr(asset.mimeType),
      };

      return Option.some(yield* Sender.use((sender) => sender.add(file, true)));
    }),
  )
  .pipe(Atom.keepAlive, Atom.withLabel("library:choose-file"));
