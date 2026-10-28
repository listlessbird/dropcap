import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { Connection, PairingLink } from "./connection";

const decodeLink = Schema.decodeUnknownEffect(PairingLink);
const decodeConnection = Schema.decodeUnknownEffect(Connection);

describe("PairingLink", () => {
  it.effect("decodes the link the pair command prints, from any app's scheme", () =>
    Effect.gen(function* () {
      const connection = yield* decodeLink(
        "kindledrop-dev://connect?server=https%3A%2F%2Fmailbox.example.dev&key=a%2Bb%3D%26c",
      );

      assert.strictEqual(connection.server, "https://mailbox.example.dev");
      assert.strictEqual(Redacted.value(connection.key), "a+b=&c");
    }),
  );

  it.effect("rejects codes that are not pairing links", () =>
    Effect.gen(function* () {
      const rejected = [
        "https://example.com/?server=https%3A%2F%2Fa.dev&key=k",
        "kindledrop://settings?server=https%3A%2F%2Fa.dev&key=k",
        "kindledrop://connect?server=https%3A%2F%2Fa.dev",
        "kindledrop://connect?server=ftp%3A%2F%2Fa.dev&key=k",
        "kindledrop://connect?server=https%3A%2F%2Fa.dev%2Fitems&key=k",
        "kindledrop://connect?server=%E0%A4%A&key=k",
        "WIFI:S:home;T:WPA;P:secret;;",
      ];

      for (const link of rejected) {
        assert.isTrue(Exit.isFailure(yield* Effect.exit(decodeLink(link))), link);
      }
    }),
  );
});

describe("Connection", () => {
  it.effect("accepts a typed address with spaces and a trailing slash", () =>
    Effect.gen(function* () {
      const connection = yield* decodeConnection({
        server: " http://10.0.2.2:1337/ ",
        key: " dev-app ",
      });

      assert.strictEqual(connection.server, "http://10.0.2.2:1337");
      assert.strictEqual(Redacted.value(connection.key), "dev-app");
    }),
  );
});
