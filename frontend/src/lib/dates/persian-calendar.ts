const dayMilliseconds = 86_400_000;
export const tehranTimeZone = "Asia/Tehran";
const persianParts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
  day: "numeric",
  timeZone: "UTC",
});
const tehranParts = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: tehranTimeZone,
});
const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: tehranTimeZone,
  timeZoneName: "longOffset",
});
export const persianDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian",
  {
    dateStyle: "long",
    timeZone: "UTC",
  },
);
export const persianMonthFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian",
  {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  },
);

// Calendar cells are Gregorian dates anchored at noon UTC, independent of the viewer's zone.
export function calendarDay(instant: Date): Date {
  const parts = tehranParts.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(
    Date.UTC(value("year"), value("month") - 1, value("day"), 12),
  );
}
export function addCalendarDays(day: Date, count: number): Date {
  return new Date(day.getTime() + count * dayMilliseconds);
}
export function persianDayNumber(day: Date): number {
  return Number(
    persianParts.formatToParts(day).find((part) => part.type === "day")?.value,
  );
}
export function persianMonthStart(day: Date): Date {
  return addCalendarDays(day, 1 - persianDayNumber(day));
}
export function adjacentPersianMonth(month: Date, direction: -1 | 1): Date {
  return persianMonthStart(addCalendarDays(month, direction === -1 ? -1 : 32));
}
function tehranMidnight(day: Date): number {
  const wallTime = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
  );
  let instant = wallTime;
  let previous = instant;
  for (let attempt = 0; attempt < 4; attempt++) {
    const offset = offsetFormatter
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value;
    const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) throw new Error("Unable to determine Tehran time zone offset");
    const seconds =
      (Number(match[2]) * 3600 +
        Number(match[3]) * 60 +
        Number(match[4] ?? 0)) *
      (match[1] === "+" ? 1 : -1);
    const next = wallTime - seconds * 1000;
    if (next === instant) return instant;
    // Historical midnight daylight-saving gaps start at the first valid instant of that day.
    if (next === previous) return Math.max(next, instant);
    previous = instant;
    instant = next;
  }
  return instant;
}
export function calendarDayBoundary(
  day: Date,
  boundary: "start" | "end",
): string {
  const instant =
    boundary === "start"
      ? tehranMidnight(day)
      : tehranMidnight(addCalendarDays(day, 1)) - 1;
  return new Date(instant).toISOString();
}
