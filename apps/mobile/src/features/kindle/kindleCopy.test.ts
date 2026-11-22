import { assert, describe, it } from "@effect/vitest";
import {
  BookPath,
  commandId,
  Command,
  type Outcome,
  type QueuedCommand,
} from "@dropcap/worker/Api";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import {
  deviceSummary,
  failures,
  libraryEntries,
  rescanPending,
  searchEntries,
} from "./kindleCopy";

const now = DateTime.fromDateUnsafe(new Date(2026, 10, 17, 12, 0));

const dune = { path: BookPath.make("/mnt/us/documents/Dune.azw3"), title: "Dune" };
const emma = { path: BookPath.make("/mnt/us/documents/Emma.azw3"), title: "Emma" };

const queued = (n: number, command: Command, outcome?: Outcome): QueuedCommand => ({
  id: commandId(n, n),
  queuedAt: now,
  command,
  outcome: Option.fromNullishOr(outcome),
});

describe("libraryEntries", () => {
  it("marks a book whose delete still waits for the Kindle, and not one that failed", () => {
    const entries = libraryEntries(
      [emma, dune],
      [
        queued(1, Command.cases.DeleteBook.make({ path: emma.path }), {
          outcome: "failed",
          message: "busy",
        }),
        queued(2, Command.cases.DeleteBook.make({ path: dune.path })),
      ],
    );

    assert.deepStrictEqual(
      entries.map(({ book, deleting }) => [book.title, Option.isSome(deleting)]),
      [
        ["Dune", true],
        ["Emma", false],
      ],
    );
  });
});

describe("rescanPending", () => {
  it("holds only until the Kindle settles the rescan", () => {
    assert.isTrue(rescanPending([queued(1, Command.cases.Rescan.make({}))]));
    assert.isFalse(rescanPending([queued(1, Command.cases.Rescan.make({}), { outcome: "ok" })]));
  });
});

describe("failures", () => {
  it("names a deleted book from its file, newest first, without the Kindle's error text", () => {
    const listed = failures([
      queued(1, Command.cases.DeleteBook.make({ path: dune.path }), {
        outcome: "failed",
        message: "busy",
      }),
      queued(2, Command.cases.Rescan.make({}), { outcome: "ok" }),
      queued(3, Command.cases.Rescan.make({}), { outcome: "failed", message: "no lipc" }),
    ]);

    assert.deepStrictEqual(
      listed.map(({ text }) => text),
      ["Couldn't rescan", "Couldn't delete Dune"],
    );
  });
});

describe("searchEntries", () => {
  it("matches titles regardless of case, and a blank query keeps every book", () => {
    const entries = libraryEntries([emma, dune], []);

    assert.deepStrictEqual(
      searchEntries(entries, " dU ").map(({ book }) => book.title),
      ["Dune"],
    );
    assert.strictEqual(searchEntries(entries, "  ").length, 2);
  });
});

describe("deviceSummary", () => {
  it("fills the storage meter only when the Kindle reports its total size", () => {
    const summary = deviceSummary(
      {
        reportedAt: now,
        battery: 83,
        charging: true,
        freeKb: 1_000_000,
        totalKb: 4_000_000,
        firmware: "5.16.2.1.1",
        books: [],
      },
      now,
    );

    assert.strictEqual(summary.checkedIn, "Kindle checked in just now · 5.16.2.1.1");
    assert.deepStrictEqual(summary.battery, Option.some({ value: "83%", charging: true }));
    assert.deepStrictEqual(
      Option.flatMap(summary.free, ({ used }) => used),
      Option.some(0.75),
    );

    const partial = deviceSummary({ reportedAt: now, freeKb: 1_000_000, books: [] }, now);
    assert.strictEqual(partial.checkedIn, "Kindle checked in just now");
    assert.isTrue(Option.isNone(partial.battery));
    assert.isTrue(Option.isNone(Option.flatMap(partial.free, ({ used }) => used)));
  });
});
