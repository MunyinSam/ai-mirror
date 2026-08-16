// Calendar period math for `mirror report` — pure, zero I/O, ported out of
// the old report.ts (which mixed this into a 300-line command file) so it's
// unit-testable on its own.
export type PeriodUnit = "day" | "week" | "month" | "year";

export interface Period {
  start: Date;
  end: Date;
}

/** Calendar period `back` steps before the one containing `now`. Weeks run
 *  Sun–Sat. `back=0` is the current (in-progress) period. */
export function periodRange(unit: PeriodUnit, back = 0, now = new Date()): Period {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (unit) {
    case "day":
      start.setDate(start.getDate() - back);
      break;
    case "week":
      start.setDate(start.getDate() - start.getDay() - back * 7);
      break;
    case "month":
      start.setDate(1);
      start.setMonth(start.getMonth() - back);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setFullYear(start.getFullYear() - back);
      break;
  }
  const end = new Date(start);
  switch (unit) {
    case "day":
      break;
    case "week":
      end.setDate(start.getDate() + 6);
      break;
    case "month":
      end.setMonth(start.getMonth() + 1, 0);
      break;
    case "year":
      end.setMonth(11, 31);
      break;
  }
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Local date, not toISOString() — UTC rendering shifts +07:00 users back a day.
export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodLabel(unit: PeriodUnit, p: Period): string {
  switch (unit) {
    case "day":
      return isoDate(p.start);
    case "week":
      return `week of ${isoDate(p.start)} → ${isoDate(p.end)}`;
    case "month":
      return `${MONTHS[p.start.getMonth()]} ${p.start.getFullYear()}`;
    case "year":
      return String(p.start.getFullYear());
  }
}

export function shortLabel(unit: PeriodUnit, p: Period): string {
  switch (unit) {
    case "day":
      return isoDate(p.start).slice(5);
    case "week":
      return `wk ${isoDate(p.start).slice(5)}`;
    case "month":
      return `${MONTHS[p.start.getMonth()]}`;
    case "year":
      return String(p.start.getFullYear());
  }
}
