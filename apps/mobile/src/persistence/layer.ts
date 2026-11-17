import * as Layer from "effect/Layer";

import * as BookFiles from "./book-files";
import * as BookStore from "./book-store";
import * as ConnectionStore from "./connection-store";
import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";

export const layer = Layer.mergeAll(
  Layer.merge(MobilePreferences.layer, BookStore.layer).pipe(
    Layer.provideMerge(MobileDatabase.layer),
  ),
  ConnectionStore.layer,
  BookFiles.layer,
);
