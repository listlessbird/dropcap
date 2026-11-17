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

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Today, 2:14 pm", "Yesterday, 9:03 am", then "12 Oct, 2:14 pm", in the phone's time zone. */
export function dayAndTime(then: DateTime.Utc, now: DateTime.Utc): string {
  const date = DateTime.toDate(then);
  const today = DateTime.toDate(now);
  const yesterday = DateTime.toDate(DateTime.subtractDuration(now, Duration.days(1)));

  const hours = date.getHours();
  const time = `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;

  const day = isSameDay(date, today)
    ? "Today"
    : isSameDay(date, yesterday)
      ? "Yesterday"
      : `${date.getDate()} ${MONTHS[date.getMonth()]}`;

  return `${day}, ${time}`;
}
