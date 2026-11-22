import { assert, describe, it } from "@effect/vitest";
import {
  BookPath,
  commandId,
  Command,
  type Outcome,
  type QueuedCommand,
} from "@kindle-drop/worker/Api";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { deviceSummary, failures, libraryEntries, rescanPending } from "./kindleCopy";

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
  it("names a deleted book from its file, newest first, and skips commands that ran", () => {
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
      ["Couldn't rescan the library: no lipc", "Couldn't delete Dune: busy"],
    );
  });
});

describe("deviceSummary", () => {
  it("says when the Kindle charges and leaves out what it could not read", () => {
    const summary = deviceSummary(
      { reportedAt: now, battery: 83, charging: true, freeKb: 2_000_000, books: [] },
      now,
    );

    assert.deepStrictEqual(summary.battery, Option.some("83%, charging"));
    assert.deepStrictEqual(summary.free, Option.some("2.0 GB free"));
    assert.isTrue(Option.isNone(summary.firmware));
  });
});
