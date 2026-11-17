import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { ToastAndroid } from "react-native";

import * as Runtime from "../../lib/runtime";
import { ConnectionStore } from "../../persistence/connection-store";
import { MobilePreferencesStore } from "../../persistence/mobile-preferences";
import { formatOf, type BookId } from "../sending/book";
import { Sender, UnsupportedFile, type IncomingFile } from "../sending/sender";

/** What ShareActivity passes as launch options: each field only when the sending app provides it. */
export const SharedFile = Schema.Struct({
  uri: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  bytes: Schema.optional(Schema.Number),
});

export type SharedFile = typeof SharedFile.Type;

export class NotConnected extends Schema.TaggedError<NotConnected>()("NotConnected", {}) {}

/** Closes the sheet and returns to the app that shared. */
export async function closeSheet() {
  const { requireNativeModule } = await import("expo");

  await requireNativeModule<{ finish(): Promise<void> }>("ShareSheet").finish();
}

export type ShareOutcome = Data.TaggedEnum<{
  Confirming: { readonly id: BookId };
  Sent: {};
}>;

export const ShareOutcome = Data.taggedEnum<ShareOutcome>();

const incoming = (shared: SharedFile) =>
  Option.map(Option.fromNullishOr(shared.uri), (uri): IncomingFile => ({
    uri,
    name: shared.name ?? decodeURIComponent(uri.slice(uri.lastIndexOf("/") + 1)),
    mimeType: Option.fromNullishOr(shared.mimeType),
  }));

/**
 * One share, taken in as soon as the sheet opens so conversion is under way before the user taps
 * Send. With "Confirm before sending" off it sends at once and closes the sheet itself.
 */
const runtime = Atom.runtime(Runtime.layer);

export const shareAtom = Atom.family((shared: SharedFile) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const file = yield* Effect.fromOption(
          Option.filter(incoming(shared), (file) =>
            Option.isSome(formatOf(file.name, file.mimeType)),
          ),
        ).pipe(Effect.mapError(() => new UnsupportedFile()));

        if (Option.isNone(yield* ConnectionStore.use((store) => store.load))) {
          return yield* new NotConnected();
        }

        const preferences = yield* MobilePreferencesStore.use((store) => store.load).pipe(
          Effect.orElseSucceed(() => ({ confirmBeforeSending: undefined })),
        );

        const confirm = preferences.confirmBeforeSending ?? true;
        const id = yield* Sender.use((sender) => sender.add(file, !confirm));

        // However the sheet goes away without Send (Cancel, a swipe, back, or leaving for Home), the
        // book goes with it. Discarding leaves a book that was sent alone.
        yield* Effect.addFinalizer(() => Sender.use((sender) => sender.discard(id)));

        if (confirm) return ShareOutcome.Confirming({ id });

        // A toast outlives the sheet, so it shows over the app that shared.
        yield* Effect.sync(() => ToastAndroid.show("Sending to Kindle", ToastAndroid.SHORT));
        yield* Effect.promise(closeSheet);

        return ShareOutcome.Sent();
      }),
    )
    .pipe(Atom.withLabel("share")),
);
