import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { ToastAndroid } from "react-native";

import * as Runtime from "../../lib/runtime";
import { ConnectionStore } from "../../persistence/connection-store";
import { MobilePreferencesStore } from "../../persistence/mobile-preferences";
import { articleUrlOf, formatOf, type BookId } from "../sending/book";
import {
  Sender,
  UnsupportedFile,
  type IncomingArticle,
  type IncomingFile,
} from "../sending/sender";

/**
 * What ShareActivity passes as launch options: a file's `uri`, `name`, `mimeType` and `bytes`, or
 * shared `text` and its `subject`, as a browser shares a page. Each only when the sender provides it.
 */
export const Shared = Schema.Struct({
  uri: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  bytes: Schema.optional(Schema.Number),
  text: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
});

export type Shared = typeof Shared.Type;

export class NotConnected extends Schema.TaggedError<NotConnected>()("NotConnected", {}) {}

/** Shared text without a link to an article. */
export class UnsupportedText extends Schema.TaggedError<UnsupportedText>()("UnsupportedText", {}) {}

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

const fileOf = (shared: Shared) =>
  Option.map(Option.fromNullishOr(shared.uri), (uri): IncomingFile => ({
    uri,
    name: shared.name ?? decodeURIComponent(uri.slice(uri.lastIndexOf("/") + 1)),
    mimeType: Option.fromNullishOr(shared.mimeType),
  })).pipe(Option.filter((file) => Option.isSome(formatOf(file.name, file.mimeType))));

/** The article a share links to. A shared file wins over text that comes with it. */
export const articleOf = (shared: Shared) =>
  shared.uri === undefined
    ? Option.map(
        Option.flatMap(Option.fromNullishOr(shared.text), articleUrlOf),
        (url): IncomingArticle => ({ url, title: Option.fromNullishOr(shared.subject) }),
      )
    : Option.none();

/** Adds the shared file or article to the Sender, or says why it cannot be sent. */
const adderOf = (shared: Shared) =>
  shared.uri === undefined && shared.text !== undefined
    ? Effect.fromOption(articleOf(shared)).pipe(
        Effect.mapBoth({
          onFailure: () => new UnsupportedText(),
          onSuccess: (article) => (confirmed: boolean) =>
            Sender.use((sender) => sender.addArticle(article, confirmed)),
        }),
      )
    : Effect.fromOption(fileOf(shared)).pipe(
        Effect.mapBoth({
          onFailure: () => new UnsupportedFile(),
          onSuccess: (file) => (confirmed: boolean) =>
            Sender.use((sender) => sender.add(file, confirmed)),
        }),
      );

/**
 * One share, taken in as soon as the sheet opens so conversion is under way before the user taps
 * Send. With "Confirm before sending" off it sends at once and closes the sheet itself.
 */
const runtime = Atom.runtime(Runtime.layer);

export const shareAtom = Atom.family((shared: Shared) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const add = yield* adderOf(shared);

        if (Option.isNone(yield* ConnectionStore.use((store) => store.load))) {
          return yield* new NotConnected();
        }

        const preferences = yield* MobilePreferencesStore.use((store) => store.load).pipe(
          Effect.orElseSucceed(() => ({ confirmBeforeSending: undefined })),
        );

        const confirm = preferences.confirmBeforeSending ?? true;

        // However the sheet goes away without Send (Cancel, a swipe, back, or leaving for Home), the
        // book goes with it, even mid-copy: adding is uninterruptible, so its discard is always
        // registered. Discarding leaves a book that was sent alone.
        const id = yield* Effect.acquireRelease(add(!confirm), (added) =>
          Sender.use((sender) => sender.discard(added)),
        );

        if (confirm) return ShareOutcome.Confirming({ id });

        // A toast outlives the sheet, so it shows over the app that shared.
        yield* Effect.sync(() => ToastAndroid.show("Sending to Kindle", ToastAndroid.SHORT));
        yield* Effect.promise(closeSheet);

        return ShareOutcome.Sent();
      }),
    )
    .pipe(Atom.withLabel("share")),
);
