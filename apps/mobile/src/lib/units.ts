import * as Duration from "effect/Duration";

/** "9.1 MB", in the decimal megabytes Android's Files app shows. */
export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** "5.7 s" */
export const seconds = (duration: Duration.Duration) =>
  `${(Duration.toMillis(duration) / 1000).toFixed(1)} s`;
