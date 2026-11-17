import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import { CHECK_FAILED, kindleChip, type KindleCheck } from "./libraryCopy";

const now = DateTime.fromDateUnsafe(new Date(2026, 10, 17, 12, 0));

const answered = (ago: Duration.Input): KindleCheck["last"] =>
  Option.some({ checkedInAt: Option.some(DateTime.subtractDuration(now, ago)) });

describe("kindleChip", () => {
  it("vouches for a recent check-in with a green dot", () => {
    const chip = Option.getOrThrow(
      kindleChip({ last: answered("2 hours"), failed: false, waiting: true }, now),
    );

    assert.strictEqual(chip.label, "Kindle checked in 2 h ago");
    assert.strictEqual(chip.dot, "positive");
    assert.isTrue(Option.isNone(chip.problem));
  });

  it("turns amber and asks to wake the Kindle when books wait on a quiet one", () => {
    const chip = Option.getOrThrow(
      kindleChip({ last: answered("3 days"), failed: false, waiting: true }, now),
    );

    assert.strictEqual(chip.dot, "caution");
    assert.deepStrictEqual(
      chip.quietNotice,
      Option.some("Kindle hasn't checked in for 3 days. Wake it to receive books."),
    );
  });

  it("keeps the last answer but stops vouching for it when the latest check fails", () => {
    const chip = Option.getOrThrow(
      kindleChip({ last: answered("3 days"), failed: true, waiting: true }, now),
    );

    assert.strictEqual(chip.label, "Kindle checked in 3 days ago");
    assert.strictEqual(chip.dot, undefined);
    assert.deepStrictEqual(chip.problem, Option.some(CHECK_FAILED));
    assert.isTrue(Option.isNone(chip.quietNotice));
  });

  it("says the check failed when there was never an answer", () => {
    const chip = Option.getOrThrow(
      kindleChip({ last: Option.none(), failed: true, waiting: false }, now),
    );

    assert.strictEqual(chip.label, CHECK_FAILED);
    assert.strictEqual(chip.dot, undefined);
    assert.isTrue(Option.isNone(chip.problem));
  });

  it("shows nothing while the first check runs", () => {
    assert.isTrue(
      Option.isNone(kindleChip({ last: Option.none(), failed: false, waiting: false }, now)),
    );
  });
});
