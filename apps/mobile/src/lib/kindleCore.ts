import type * as Native from "@kindle-drop/kindle-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export type Converted = Native.Converted;

export type Thumbnail = Native.Thumbnail;

export class ConvertError extends Schema.TaggedError<ConvertError>()("ConvertError", {
  stage: Schema.Literals(["Epub", "Build", "Thumbnail", "Io", "Fetch", "Article"]),
  message: Schema.String,
}) {}

/**
 * The Rust converter in modules/kindle-core. Paths are file system paths, not `file://` URIs. A book
 * without a cover converts without a thumbnail.
 */
export class KindleCore extends Context.Service<
  KindleCore,
  {
    /**
     * Writes an EBOK `.azw3` and its Kindle thumbnail into `outDir`. Interrupting stops the Rust
     * work at its next stage boundary and removes what it wrote. kindling's build, most of a
     * conversion, cannot be stopped midway, so that much may still run in the background.
     */
    readonly convertEpub: (
      epubPath: string,
      outDir: string,
    ) => Effect.Effect<Converted, ConvertError>;
    /**
     * Fetches a web article and converts its readable part, as `convertEpub` does. Fails in the
     * `Fetch` stage when the page cannot be reached, as when the phone is offline.
     */
    readonly convertArticle: (
      url: string,
      outDir: string,
    ) => Effect.Effect<Converted, ConvertError>;
    /** Writes the Kindle thumbnail of an existing EBOK `.azw3` into `outDir`. */
    readonly deviceThumbnail: (
      azw3Path: string,
      outDir: string,
    ) => Effect.Effect<Thumbnail, ConvertError>;
  }
>()("@kindle-drop/mobile/lib/KindleCore") {}

export const make = Effect.gen(function* () {
  // Imported lazily: loading the module installs the Rust crate, which Node tests cannot do.
  const native = yield* Effect.promise(() => import("@kindle-drop/kindle-core"));

  // The AbortSignal makes interruption drop the Rust future, which the Rust side checks for.
  const call = <A>(run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
      Effect.catch((cause) =>
        native.ConvertError.instanceOf(cause)
          ? Effect.fail(new ConvertError({ stage: cause.tag, message: cause.inner[0] }))
          : Effect.die(cause),
      ),
    );

  const convertEpub = Effect.fn("KindleCore.convertEpub")(function* (
    epubPath: string,
    outDir: string,
  ) {
    return yield* call((signal) => native.convertEpub(epubPath, outDir, { signal }));
  });

  const convertArticle = Effect.fn("KindleCore.convertArticle")(function* (
    url: string,
    outDir: string,
  ) {
    return yield* call((signal) => native.convertArticle(url, outDir, { signal }));
  });

  const deviceThumbnail = Effect.fn("KindleCore.deviceThumbnail")(function* (
    azw3Path: string,
    outDir: string,
  ) {
    return yield* call((signal) => native.deviceThumbnail(azw3Path, outDir, { signal }));
  });

  return KindleCore.of({ convertEpub, convertArticle, deviceThumbnail });
});

export const layer = Layer.effect(KindleCore, make);
