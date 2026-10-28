import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then "12 Oct" after a week. */
export function relativeTime(then: DateTime.Utc, now: DateTime.Utc): string {
  const elapsed = DateTime.distance(then, now);

  if (Duration.isLessThan(elapsed, Duration.minutes(1))) return "Just now";

  if (Duration.isLessThan(elapsed, Duration.hours(1)))
    return `${Math.floor(Duration.toMinutes(elapsed))} min ago`;

  if (Duration.isLessThan(elapsed, Duration.days(1)))
    return `${Math.floor(Duration.toHours(elapsed))} h ago`;

  if (Duration.isLessThan(elapsed, Duration.days(2))) return "Yesterday";

  if (Duration.isLessThan(elapsed, Duration.weeks(1)))
    return `${Math.floor(Duration.toDays(elapsed))} days ago`;

  const date = DateTime.toDate(then);

  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
