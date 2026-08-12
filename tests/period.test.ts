import { describe, expect, test } from "bun:test";
import { isoDate, periodLabel, periodRange, shortLabel } from "../src/domain/period.ts";

const wed = new Date("2026-08-05T15:00:00"); // Wednesday

describe("periodRange", () => {
  test("day: back=0 is today, midnight to end of day", () => {
    const p = periodRange("day", 0, wed);
    expect(isoDate(p.start)).toBe("2026-08-05");
    expect(isoDate(p.end)).toBe("2026-08-05");
    expect(p.start.getHours()).toBe(0);
    expect(p.end.getHours()).toBe(23);
  });

  test("day: back=1 is yesterday", () => {
    expect(isoDate(periodRange("day", 1, wed).start)).toBe("2026-08-04");
  });

  test("week runs Sun-Sat and contains `now`", () => {
    const p = periodRange("week", 0, wed);
    expect(p.start.getDay()).toBe(0);
    expect(p.end.getDay()).toBe(6);
    expect(wed >= p.start && wed <= p.end).toBe(true);
  });

  test("week: back=1 is the prior week", () => {
    const current = periodRange("week", 0, wed);
    const prior = periodRange("week", 1, wed);
    expect(prior.end < current.start).toBe(true);
  });

  test("month spans the 1st to the last day", () => {
    const p = periodRange("month", 0, wed);
    expect(isoDate(p.start)).toBe("2026-08-01");
    expect(isoDate(p.end)).toBe("2026-08-31");
  });

  test("year spans Jan 1 to Dec 31", () => {
    const p = periodRange("year", 0, wed);
    expect(isoDate(p.start)).toBe("2026-01-01");
    expect(isoDate(p.end)).toBe("2026-12-31");
  });
});

describe("periodLabel / shortLabel", () => {
  test("day label is the iso date", () => {
    expect(periodLabel("day", periodRange("day", 0, wed))).toBe("2026-08-05");
  });

  test("month label is 'Mon YYYY'", () => {
    expect(periodLabel("month", periodRange("month", 0, wed))).toBe("Aug 2026");
  });

  test("shortLabel drops the year for day/week", () => {
    expect(shortLabel("day", periodRange("day", 0, wed))).toBe("08-05");
  });
});
