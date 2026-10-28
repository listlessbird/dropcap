import type * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ItemKey, itemKey, type ItemName } from "./Api.ts";

type Run<A> = Effect.Effect<A, never, Alchemy.RuntimeContext>;

/**
 * Books waiting for the Kindle, and the diagnostics it reports back.
 * @effect-expect-leaking RuntimeContext
 */
export class Mailbox extends Context.Service<
  Mailbox,
  {
    readonly upload: (name: ItemName, body: ReadableStream<Uint8Array>) => Run<ItemKey>;
    readonly list: Run<ReadonlyArray<ItemKey>>;
    readonly download: (key: ItemKey) => Run<Option.Option<Stream.Stream<Uint8Array>>>;
    readonly remove: (key: ItemKey) => Run<void>;
    readonly putReport: (
      name: ItemName,
      body: Option.Option<ReadableStream<Uint8Array>>,
    ) => Run<void>;
    readonly getReport: (name: ItemName) => Run<Option.Option<string>>;
  }
>()("@kindle-drop/worker/Mailbox") {}

export const Bucket = Cloudflare.R2.Bucket("Bucket", {
  name: "kindle-mailbox",
  locationHint: "apac",
  lifecycleRules: [
    { id: "expire-undelivered-items", prefix: "items/" },
    { id: "expire-reports", prefix: "reports/" },
  ].map((rule) => ({
    ...rule,
    deleteObjectsTransition: {
      condition: { type: "Age", maxAge: Duration.toSeconds(Duration.days(30)) },
    },
  })),
}).pipe(adopt(true), retain());

export const MailboxR2 = Layer.effect(
  Mailbox,
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(yield* Bucket);

    const firstPage: Cloudflare.R2.ListOptions = { prefix: "items/" };

    // R2 failures are outages, not outcomes a caller can act on, so they surface as 500s.
    return {
      upload: Effect.fn("Mailbox.upload")(function* (name, body) {
        const key = itemKey(yield* Clock.currentTimeMillis, name);

        yield* bucket.put(key, body);

        return key;
      }, Effect.orDie),
      list: Stream.paginate(firstPage, (options) =>
        Effect.map(bucket.list(options), (page) => [
          page.objects.map((object) => ItemKey.make(object.key)),
          page.truncated ? Option.some({ prefix: "items/", cursor: page.cursor }) : Option.none(),
        ]),
      ).pipe(
        Stream.runCollect,
        Effect.map((keys) => keys.toSorted()),
        Effect.orDie,
        Effect.withSpan("Mailbox.list"),
      ),
      download: Effect.fn("Mailbox.download")(function* (key) {
        const object = yield* bucket.get(key);

        return Option.fromNullishOr(object).pipe(Option.map(({ body }) => Stream.orDie(body)));
      }, Effect.orDie),
      remove: Effect.fn("Mailbox.remove")(function* (key) {
        yield* bucket.delete(key);
      }, Effect.orDie),
      putReport: Effect.fn("Mailbox.putReport")(function* (name, body) {
        yield* bucket.put(
          `reports/${name}`,
          Option.getOrElse(body, () => ""),
        );
      }, Effect.orDie),
      getReport: Effect.fn("Mailbox.getReport")(function* (name) {
        const object = yield* bucket.get(`reports/${name}`);

        return yield* Option.fromNullishOr(object).pipe(
          Option.map((report) => report.text()),
          Effect.transposeOption,
        );
      }, Effect.orDie),
    };
  }),
).pipe(Layer.provide(Cloudflare.R2.ReadWriteBucketBinding));
