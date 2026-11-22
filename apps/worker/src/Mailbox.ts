import type * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  Command,
  commandId,
  CommandId,
  Device,
  type DeviceReport,
  ItemKey,
  itemKey,
  type ItemName,
  Outcome,
  type QueuedCommand,
  queuedAtOfId,
} from "./Api.ts";

type Run<A> = Effect.Effect<A, never, Alchemy.RuntimeContext>;

/**
 * Books and commands waiting for the Kindle, and what it reports back.
 * @effect-expect-leaking RuntimeContext
 */
export class Mailbox extends Context.Service<
  Mailbox,
  {
    readonly upload: (name: ItemName, body: ReadableStream<Uint8Array>) => Run<ItemKey>;
    readonly list: Run<ReadonlyArray<ItemKey>>;
    /** Records that the Kindle just listed the mailbox. */
    readonly checkIn: Run<void>;
    readonly checkedInAt: Run<Option.Option<DateTime.Utc>>;
    readonly download: (key: ItemKey) => Run<Option.Option<Stream.Stream<Uint8Array>>>;
    readonly remove: (key: ItemKey) => Run<void>;
    readonly putReport: (
      name: ItemName,
      body: Option.Option<ReadableStream<Uint8Array>>,
    ) => Run<void>;
    readonly getReport: (name: ItemName) => Run<Option.Option<string>>;
    readonly putDevice: (report: DeviceReport) => Run<void>;
    readonly device: Run<Option.Option<Device>>;
    readonly queue: (command: Command) => Run<CommandId>;
    /** Every command queued in the last 30 days, oldest first. */
    readonly commands: Run<ReadonlyArray<QueuedCommand>>;
    readonly settle: (id: CommandId, outcome: Outcome) => Run<void>;
    readonly dismiss: (id: CommandId) => Run<void>;
  }
>()("@dropcap/worker/Mailbox") {}

export const Bucket = Cloudflare.R2.Bucket("Bucket", {
  name: "kindle-mailbox",
  locationHint: "apac",
  lifecycleRules: [
    { id: "expire-undelivered-items", prefix: "items/" },
    { id: "expire-reports", prefix: "reports/" },
    { id: "expire-commands", prefix: "commands/" },
  ].map((rule) => ({
    ...rule,
    deleteObjectsTransition: {
      condition: { type: "Age", maxAge: Duration.toSeconds(Duration.days(30)) },
    },
  })),
}).pipe(adopt(true), retain());

const encodeCommand = Schema.encodeSync(Command);
const decodeCommand = Schema.decodeUnknownEffect(Command);
const decodeOutcome = Schema.decodeUnknownOption(Outcome);
const DeviceJson = Schema.fromJsonString(Device);
const encodeDevice = Schema.encodeSync(DeviceJson);
const decodeDevice = Schema.decodeUnknownOption(DeviceJson);

// The Worker wrote this metadata itself, so a command that does not decode is a bug.
const queuedCommand = Effect.fn("Mailbox.queuedCommand")(function* (object: {
  readonly key: string;
  readonly customMetadata?: unknown;
}) {
  const id = CommandId.make(object.key.slice("commands/".length));

  return {
    id,
    queuedAt: DateTime.makeUnsafe(queuedAtOfId(id)),
    command: yield* decodeCommand(object.customMetadata),
    outcome: decodeOutcome(object.customMetadata),
  } satisfies QueuedCommand;
}, Effect.orDie);

export const MailboxR2 = Layer.effect(
  Mailbox,
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(yield* Bucket);

    const listAll = (options: Cloudflare.R2.ListOptions) =>
      Stream.paginate(options, (page) =>
        Effect.map(bucket.list(page), (listed) => [
          listed.objects,
          listed.truncated ? Option.some({ ...options, cursor: listed.cursor }) : Option.none(),
        ]),
      ).pipe(Stream.runCollect, Effect.orDie);

    // Outside the lifecycle rules' prefixes, so a Kindle asleep for a month still has a check-in.
    const checkInKey = "state/checked-in";
    const deviceKey = "state/device";

    const commandKey = (id: CommandId) => `commands/${id}`;

    // A command's object is empty. Its custom metadata holds the encoded command and, once the
    // Kindle settles it, the outcome.
    const metadataOf = (command: Command, outcome?: Outcome) => ({
      ...encodeCommand(command),
      ...outcome,
    });

    // R2 failures are outages, not outcomes a caller can act on, so they surface as 500s.
    return {
      upload: Effect.fn("Mailbox.upload")(function* (name, body) {
        const key = itemKey(yield* Clock.currentTimeMillis, name);

        yield* bucket.put(key, body);

        return key;
      }, Effect.orDie),
      list: listAll({ prefix: "items/" }).pipe(
        Effect.map((objects) => objects.map((object) => ItemKey.make(object.key)).toSorted()),
        Effect.withSpan("Mailbox.list"),
      ),
      checkIn: bucket
        .put(checkInKey, "")
        .pipe(Effect.asVoid, Effect.orDie, Effect.withSpan("Mailbox.checkIn")),
      checkedInAt: bucket.head(checkInKey).pipe(
        Effect.map((object) =>
          Option.fromNullishOr(object).pipe(
            Option.map(({ uploaded }) => DateTime.fromDateUnsafe(uploaded)),
          ),
        ),
        Effect.orDie,
        Effect.withSpan("Mailbox.checkedInAt"),
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
      putDevice: Effect.fn("Mailbox.putDevice")(function* (report) {
        const reportedAt = yield* DateTime.now;

        yield* bucket.put(deviceKey, encodeDevice({ ...report, reportedAt }));
      }, Effect.orDie),
      // A report stored before a schema change reads as no report until the next wake.
      device: bucket.get(deviceKey).pipe(
        Effect.flatMap((object) =>
          object === null ? Effect.succeedNone : Effect.map(object.text(), decodeDevice),
        ),
        Effect.orDie,
        Effect.withSpan("Mailbox.device"),
      ),
      queue: Effect.fn("Mailbox.queue")(function* (command) {
        const id = commandId(yield* Clock.currentTimeMillis, yield* Random.nextInt);

        yield* bucket.put(commandKey(id), "", { customMetadata: metadataOf(command) });

        return id;
      }, Effect.orDie),
      commands: listAll({ prefix: "commands/", include: ["customMetadata"] }).pipe(
        Effect.flatMap(Effect.forEach(queuedCommand)),
        Effect.map((commands) => commands.toSorted((a, b) => (a.id < b.id ? -1 : 1))),
        Effect.withSpan("Mailbox.commands"),
      ),
      settle: Effect.fn("Mailbox.settle")(function* (id, outcome) {
        const object = yield* bucket.head(commandKey(id));

        if (object === null) return;

        const { command } = yield* queuedCommand(object);

        yield* bucket.put(commandKey(id), "", { customMetadata: metadataOf(command, outcome) });
      }, Effect.orDie),
      dismiss: Effect.fn("Mailbox.dismiss")(function* (id) {
        yield* bucket.delete(commandKey(id));
      }, Effect.orDie),
    };
  }),
).pipe(Layer.provide(Cloudflare.R2.ReadWriteBucketBinding));
