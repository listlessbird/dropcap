import * as Layer from "effect/Layer";

import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";

export const layer = MobilePreferences.layer.pipe(Layer.provideMerge(MobileDatabase.layer));
