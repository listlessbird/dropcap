import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";

import { relativeTime } from "./relativeTime";

const now = DateTime.fromDateUnsafe(new Date(2026, 9, 28, 12, 0));
const ago = (duration: Duration.Input) => DateTime.subtractDuration(now, duration);

describe("relativeTime", () => {
  it("is relative within a week and a date after", () => {
    assert.strictEqual(relativeTime(ago("30 seconds"), now), "Just now");
    assert.strictEqual(relativeTime(ago("59 minutes"), now), "59 min ago");
    assert.strictEqual(relativeTime(ago("2 hours"), now), "2 h ago");
    assert.strictEqual(relativeTime(ago("30 hours"), now), "Yesterday");
    assert.strictEqual(relativeTime(ago("3 days"), now), "3 days ago");
    assert.strictEqual(relativeTime(ago("16 days"), now), "12 Oct");
  });
});
