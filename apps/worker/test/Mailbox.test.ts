import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { expect } from "@effect/vitest";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import Stack from "../alchemy.run.ts";
import { BookPath, Command, type CommandId, ItemId, ItemName, MailboxApi } from "../src/Api.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
  dev: true,
  // With alchemy 2.0.0-beta.80's dev sidecar, destroy(Stack) never returns.
  sidecar: false,
});

const stack = beforeAll(deploy(Stack));

afterAll(destroy(Stack));

const encodeId = Schema.encodeSync(ItemId);

const appToken = Config.String("APP_TOKEN");
const kindleToken = Config.String("KINDLE_TOKEN");

const appClient = Effect.gen(function* () {
  const { url } = yield* stack;
  const token = yield* appToken;

  return yield* HttpApiClient.make(MailboxApi, {
    baseUrl: url,
    transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
  });
});

// Requests shaped like ts.sh's `curl -sf -H "Authorization: Bearer ..."` on the Kindle.
const kindle = (method: "GET" | "PUT" | "DELETE", path: string, as = kindleToken) =>
  Effect.gen(function* () {
    const { url } = yield* stack;
    const token = yield* as;

    return yield* HttpClient.execute(
      HttpClientRequest.make(method)(`${url}${path}`).pipe(HttpClientRequest.bearerToken(token)),
    );
  });

// `curl --data-urlencode name=value ...`: repeated names, curl's default form content type.
const kindleForm = (path: string, fields: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function* () {
    const { url } = yield* stack;

    return yield* HttpClient.execute(
      HttpClientRequest.put(`${url}${path}`).pipe(
        HttpClientRequest.bearerToken(yield* kindleToken),
        HttpClientRequest.setBody(
          HttpBody.text(
            new URLSearchParams(fields.map(([name, value]) => [name, value])).toString(),
            "application/x-www-form-urlencoded",
          ),
        ),
      ),
    );
  });

const pendingCommands = Effect.gen(function* () {
  const response = yield* kindle("GET", "/commands/");
  const lines = (yield* response.text).split("\n").filter(Boolean);

  return lines.map((line) => line.split("\t"));
});

const outcomeOf = (id: CommandId) =>
  Effect.gen(function* () {
    const app = yield* appClient;
    const { commands } = yield* app.app.status();

    return commands.find((command) => command.id === id)?.outcome;
  });

const listing = Effect.gen(function* () {
  const response = yield* kindle("GET", "/items/");
  const lines = (yield* response.text).split("\n").filter(Boolean);

  return lines.map((line) => line.split("\t"));
});

const bytes = (text: string) => new TextEncoder().encode(text);

test(
  "the Kindle lists a book's thumbnail before the book",
  Effect.gen(function* () {
    const app = yield* appClient;

    const thumbnail = yield* app.app.upload({
      params: { name: ItemName.make("thumbnail_B0ORDER_EBOK_portrait.jpg") },
      payload: bytes("jpeg"),
    });

    const book = yield* app.app.upload({
      params: { name: ItemName.make("Дюна - Frank Herbert.azw3") },
      payload: bytes("azw3"),
    });

    const ids = (yield* listing).map(([id]) => id);
    expect(ids.indexOf(encodeId(thumbnail))).toBeLessThan(ids.indexOf(encodeId(book)));
    expect(yield* listing).toContainEqual([encodeId(book), "Дюна - Frank Herbert.azw3"]);
  }),
);

test(
  "a downloaded book matches the upload and is gone once the Kindle deletes it",
  Effect.gen(function* () {
    const app = yield* appClient;

    const key = yield* app.app.upload({
      params: { name: ItemName.make("download.azw3") },
      payload: bytes("book"),
    });

    const id = encodeId(key);

    expect(yield* (yield* kindle("GET", `/items/${id}`)).text).toBe("book");
    expect((yield* kindle("DELETE", `/items/${id}`)).status).toBe(204);
    expect((yield* kindle("GET", `/items/${id}`)).status).toBe(404);
    expect((yield* listing).map(([itemId]) => itemId)).not.toContain(id);
  }),
);

test(
  "the Kindle downloads and removes an item whose name fills the converter's 120 characters",
  Effect.gen(function* () {
    const app = yield* appClient;
    const name = `${"Memories of Ice_ Book 3 of the Malazan Book of the Fallen ".repeat(2).slice(0, 115)}.azw3`;

    const id = encodeId(
      yield* app.app.upload({ params: { name: ItemName.make(name) }, payload: bytes("long") }),
    );

    expect(yield* (yield* kindle("GET", `/items/${id}`)).text).toBe("long");
    expect((yield* kindle("DELETE", `/items/${id}`)).status).toBe(204);
  }),
);

test(
  "each token only opens its own side of the mailbox",
  Effect.gen(function* () {
    const { url } = yield* stack;

    const upload = (as: Config.Config<string>) =>
      Effect.flatMap(as, (token) =>
        HttpClient.execute(
          HttpClientRequest.put(`${url}/items/x.azw3`).pipe(
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.setBody(HttpBody.text("x")),
          ),
        ),
      );

    expect((yield* kindle("GET", "/items/", appToken)).status).toBe(401);
    expect((yield* kindle("GET", "/items/", Config.succeed("wrong"))).status).toBe(401);
    expect((yield* upload(kindleToken)).status).toBe(401);
    expect((yield* upload(appToken)).status).toBe(201);
  }),
);

test(
  "the app reads what the Kindle reports",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const app = yield* appClient;

    // curl --data-binary defaults to a form content type, and the Worker must take it as raw bytes.
    const put = yield* HttpClient.execute(
      HttpClientRequest.put(`${url}/reports/lab.log`).pipe(
        HttpClientRequest.bearerToken(yield* kindleToken),
        HttpClientRequest.setBody(HttpBody.text("guard ok", "application/x-www-form-urlencoded")),
      ),
    );

    expect(put.status).toBe(204);
    expect(yield* app.app.report({ params: { name: ItemName.make("lab.log") } })).toBe("guard ok");
  }),
);

test(
  "rejects names the Kindle could not store, and ids outside the item queue",
  Effect.gen(function* () {
    expect((yield* kindle("PUT", "/items/a%2Fb", appToken)).status).toBe(400);
    expect((yield* kindle("GET", `/items/${Base64Url.encode("reports/lab.log")}`)).status).toBe(
      400,
    );
  }),
);

test(
  "the app sees when the Kindle last checked in and which items still wait",
  Effect.gen(function* () {
    const app = yield* appClient;

    const key = yield* app.app.upload({
      params: { name: ItemName.make("status.azw3") },
      payload: bytes("book"),
    });

    const before = yield* app.app.status();
    expect(before.waiting).toContain(key);

    yield* listing;

    const after = yield* app.app.status();
    expect(Option.isSome(after.checkedInAt)).toBe(true);

    if (Option.isSome(before.checkedInAt) && Option.isSome(after.checkedInAt)) {
      expect(DateTime.isLessThanOrEqualTo(before.checkedInAt.value, after.checkedInAt.value)).toBe(
        true,
      );
    }

    yield* kindle("DELETE", `/items/${encodeId(key)}`);
    expect((yield* app.app.status()).waiting).not.toContain(key);
  }),
);

test(
  "the app cancels a waiting item and the Kindle never lists it",
  Effect.gen(function* () {
    const app = yield* appClient;

    const key = yield* app.app.upload({
      params: { name: ItemName.make("cancel.azw3") },
      payload: bytes("book"),
    });

    yield* app.shared.remove({ params: { id: key } });

    expect((yield* listing).map(([id]) => id)).not.toContain(encodeId(key));
    expect(
      (yield* kindle("DELETE", `/items/${encodeId(key)}`, Config.succeed("wrong"))).status,
    ).toBe(401);
  }),
);

test(
  "the Kindle runs queued commands in order and the app sees how each ended",
  Effect.gen(function* () {
    const app = yield* appClient;
    const path = BookPath.make("/mnt/us/documents/Old Book.azw3");

    const deleteId = yield* app.app.queue({
      payload: { command: Command.cases.DeleteBook.make({ path }) },
    });

    const rescanId = yield* app.app.queue({ payload: { command: Command.cases.Rescan.make({}) } });

    const pending = yield* pendingCommands;
    const ours = pending.filter(([id]) => id === deleteId || id === rescanId);
    expect(ours).toEqual([
      [deleteId, "delete", path],
      [rescanId, "rescan"],
    ]);

    expect(yield* outcomeOf(deleteId)).toEqual(Option.none());

    expect((yield* kindleForm(`/commands/${deleteId}`, [["outcome", "ok"]])).status).toBe(204);
    expect(
      (yield* kindleForm(`/commands/${rescanId}`, [
        ["outcome", "failed"],
        ["message", "lipc: no such property"],
      ])).status,
    ).toBe(204);

    expect((yield* pendingCommands).map(([id]) => id)).not.toContain(deleteId);
    expect((yield* pendingCommands).map(([id]) => id)).not.toContain(rescanId);
    expect(yield* outcomeOf(deleteId)).toEqual(Option.some({ outcome: "ok" }));
    expect(yield* outcomeOf(rescanId)).toEqual(
      Option.some({ outcome: "failed", message: "lipc: no such property" }),
    );
  }),
);

test(
  "a cancelled command is never run, even if the Kindle acknowledges it late",
  Effect.gen(function* () {
    const app = yield* appClient;
    const id = yield* app.app.queue({ payload: { command: Command.cases.Rescan.make({}) } });

    yield* app.app.dismiss({ params: { id } });

    expect((yield* pendingCommands).map(([pending]) => pending)).not.toContain(id);
    expect((yield* kindleForm(`/commands/${id}`, [["outcome", "ok"]])).status).toBe(204);
    expect(yield* outcomeOf(id)).toBeUndefined();
  }),
);

test(
  "the Worker refuses a delete outside the Kindle's documents folder",
  Effect.gen(function* () {
    const { url } = yield* stack;

    for (const path of ["/mnt/us/system/thumbnails/x.jpg", "/mnt/us/documents/../system"]) {
      const response = yield* HttpClient.execute(
        HttpClientRequest.post(`${url}/commands`).pipe(
          HttpClientRequest.bearerToken(yield* appToken),
          HttpClientRequest.setBody(
            HttpBody.text(
              `{"command":{"_tag":"DeleteBook","path":${JSON.stringify(path)}}}`,
              "application/json",
            ),
          ),
        ),
      );

      expect(response.status).toBe(400);
    }
  }),
);

test(
  "the app reads the Kindle's last report, and a malformed report leaves it in place",
  Effect.gen(function* () {
    const app = yield* appClient;

    const put = yield* kindleForm("/device", [
      ["battery", "83"],
      ["charging", "1"],
      ["freeKb", "2048000"],
      ["totalKb", "3188640"],
      ["firmware", "5.16.2.1.1"],
      ["books", "/mnt/us/documents/A.azw3\tA Book"],
      ["books", "/mnt/us/documents/sub/B #2; draft.azw3\tB #2; draft"],
    ]);

    expect(put.status).toBe(204);

    const device = (yield* app.app.status()).device;
    expect(Option.map(device, ({ reportedAt: _, ...rest }) => rest)).toEqual(
      Option.some({
        battery: 83,
        charging: true,
        freeKb: 2048000,
        totalKb: 3188640,
        firmware: "5.16.2.1.1",
        books: [
          { path: "/mnt/us/documents/A.azw3", title: "A Book" },
          { path: "/mnt/us/documents/sub/B #2; draft.azw3", title: "B #2; draft" },
        ],
      }),
    );

    expect((yield* kindleForm("/device", [["battery", "full"]])).status).toBe(400);
    expect((yield* app.app.status()).device).toEqual(device);

    // One book is one form value, not a list, and an empty library sends none.
    expect((yield* kindleForm("/device", [["books", "/mnt/us/documents/A.azw3\tA"]])).status).toBe(
      204,
    );
    expect(Option.map((yield* app.app.status()).device, ({ books }) => books.length)).toEqual(
      Option.some(1),
    );
    expect((yield* kindleForm("/device", [["battery", "5"]])).status).toBe(204);
    expect(Option.map((yield* app.app.status()).device, ({ books }) => books)).toEqual(
      Option.some([]),
    );
  }),
);
