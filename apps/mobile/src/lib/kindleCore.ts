import type * as Native from "@kindle-drop/kindle-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export type Converted = Native.Converted;

export class ConvertError extends Schema.TaggedError<ConvertError>()("ConvertError", {
  stage: Schema.Literals(["Epub", "Build", "Thumbnail", "Io"]),
  message: Schema.String,
}) {}

/** The Rust EPUB converter in modules/kindle-core. */
export class KindleCore extends Context.Service<
  KindleCore,
  {
    /**
     * Writes an EBOK `.azw3` and its Kindle thumbnail into `outDir`. Both arguments are file system
     * paths, not `file://` URIs. Interrupting cancels the Rust future at once, but kindling cannot
     * be stopped mid-book: its thread finishes in the background and may still write `outDir`.
     */
    readonly convertEpub: (
      epubPath: string,
      outDir: string,
    ) => Effect.Effect<Converted, ConvertError>;
  }
>()("@kindle-drop/mobile/lib/KindleCore") {}

export const make = Effect.gen(function* () {
  // Imported lazily: loading the module installs the Rust crate, which Node tests cannot do.
  const native = yield* Effect.promise(() => import("@kindle-drop/kindle-core"));

  const convertEpub = Effect.fn("KindleCore.convertEpub")(function* (
    epubPath: string,
    outDir: string,
  ) {
    return yield* Effect.tryPromise({
      try: (signal) => native.convertEpub(epubPath, outDir, { signal }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        native.ConvertError.instanceOf(cause)
          ? Effect.fail(new ConvertError({ stage: cause.tag, message: cause.inner[0] }))
          : Effect.die(cause),
      ),
    );
  });

  return KindleCore.of({ convertEpub });
});

export const layer = Layer.effect(KindleCore, make);
