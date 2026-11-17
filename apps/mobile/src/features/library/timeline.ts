import type * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { dayAndTime } from "../../lib/relativeTime";
import { megabytes, seconds } from "../../lib/units";
import { BookStatus, convertedOf, uploadedAt, type Book } from "../sending/book";

export type StepState = "done" | "now" | "next" | "failed";

export interface Step {
  readonly label: string;
  readonly state: StepState;
  readonly detail?: string;
}

const ARRIVES = "Arrives the next time your Kindle wakes";

/** Converted, Uploaded, Waiting for Kindle, On Kindle. A PDF has nothing to convert, so it starts at Uploaded. */
export const timelineOf = (
  book: Book,
  progress: Option.Option<number>,
  now: DateTime.Utc,
): ReadonlyArray<Step> => {
  const converted = Option.map(convertedOf(book.status), (c) =>
    [megabytes(c.bookBytes), ...Option.toArray(Option.map(c.convertedIn, seconds))].join(" · "),
  );

  const step = (label: string, state: StepState, detail?: string): Step => ({
    label,
    state,
    detail,
  });

  const [first, uploaded, waiting, onKindle] = BookStatus.match<ReadonlyArray<Step>>(book.status, {
    Converting: () => [
      step("Converted", "now", "Converting"),
      step("Uploaded", "next"),
      step("Waiting for Kindle", "next"),
      step("On Kindle", "next"),
    ],
    Ready: () => [
      step("Converted", "done", Option.getOrUndefined(converted)),
      step("Uploaded", "next"),
      step("Waiting for Kindle", "next"),
      step("On Kindle", "next"),
    ],
    Uploading: () => [
      step("Converted", "done", Option.getOrUndefined(converted)),
      step(
        "Uploaded",
        "now",
        `Uploading · ${Math.round(Option.getOrElse(progress, () => 0) * 100)}%`,
      ),
      step("Waiting for Kindle", "next"),
      step("On Kindle", "next"),
    ],
    Waiting: ({ items }) => [
      step("Converted", "done", Option.getOrUndefined(converted)),
      step("Uploaded", "done", dayAndTime(uploadedAt(items), now)),
      step("Waiting for Kindle", "now", ARRIVES),
      step("On Kindle", "next"),
    ],
    OnKindle: ({ items, arrivedAt }) => [
      step("Converted", "done", Option.getOrUndefined(converted)),
      step("Uploaded", "done", dayAndTime(uploadedAt(items), now)),
      step("Waiting for Kindle", "done"),
      step("On Kindle", "done", dayAndTime(arrivedAt, now)),
    ],
    ConvertFailed: () => [
      step("Converted", "failed", "Couldn't convert"),
      step("Uploaded", "next"),
      step("Waiting for Kindle", "next"),
      step("On Kindle", "next"),
    ],
    UploadFailed: () => [
      step("Converted", "done", Option.getOrUndefined(converted)),
      step("Uploaded", "failed", "Couldn't upload"),
      step("Waiting for Kindle", "next"),
      step("On Kindle", "next"),
    ],
    Canceled: ({ at }) => [
      step("Converted", "done", Option.getOrUndefined(converted)),
      step("Uploaded", "done"),
      step("Waiting for Kindle", "next", `Sending canceled · ${dayAndTime(at, now)}`),
      step("On Kindle", "next"),
    ],
  });

  const steps = [first, uploaded, waiting, onKindle].flatMap((s) => (s ? [s] : []));

  return book.source.format === "pdf" ? steps.slice(1) : steps;
};
