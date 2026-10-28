import * as Layer from "effect/Layer";

import * as ConnectionStore from "./connection-store";
import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";

export const layer = Layer.merge(
  MobilePreferences.layer.pipe(Layer.provideMerge(MobileDatabase.layer)),
  ConnectionStore.layer,
);
