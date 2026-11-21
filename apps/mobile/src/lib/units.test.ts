import { assert, describe, it } from "@effect/vitest";

import { fileSize } from "./units";

describe("fileSize", () => {
  it("shows a small file in kilobytes rather than as 0.0 MB", () => {
    for (const [bytes, expected] of [
      [1_663, "1.7 kB"],
      [152_512, "153 kB"],
      [999_499, "999 kB"],
      [9_100_000, "9.1 MB"],
      [12, "0.1 kB"],
    ] as const) {
      assert.strictEqual(fileSize(bytes), expected);
    }
  });
});
