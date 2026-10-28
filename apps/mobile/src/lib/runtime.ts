import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import * as Persistence from "../persistence/layer";
import { disposeOnFoundationReplace, type FoundationHotModule } from "./foundation-fast-refresh";
import * as MailboxClient from "./mailboxClient";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

// One runtime builds the app's services once. Atom runtimes share it through `layer` instead of
// each building their own copy (and their own database connection).
export const runtime = ManagedRuntime.make(Layer.merge(Persistence.layer, MailboxClient.layer));

export const layer = Layer.effectContext(runtime.contextEffect);

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () =>
  runtime.dispose(),
);
