import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { expect } from "@effect/vitest";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import Stack from "../alchemy.run.ts";
import { ItemId, ItemName, MailboxApi } from "../src/Api.ts";

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
