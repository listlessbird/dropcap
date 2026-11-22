import * as Duration from "effect/Duration";

/** "9.1 MB", "153 kB" or "1.7 kB", in the decimal units Android's Files app shows. */
export const fileSize = (bytes: number) => {
  const kilobytes = bytes / 1_000;

  if (kilobytes < 10) return `${Math.max(kilobytes, 0.1).toFixed(1)} kB`;

  if (Math.round(kilobytes) < 1_000) return `${Math.round(kilobytes)} kB`;

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

/** "5.7 s" */
export const seconds = (duration: Duration.Duration) =>
  `${(Duration.toMillis(duration) / 1000).toFixed(1)} s`;

/** "2.1 GB", decimal like `megabytes`. */
export const gigabytes = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;
