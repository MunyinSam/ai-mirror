import { describe, expect, test } from "bun:test";
import { periodLabel, periodRange } from "../src/commands/report.ts";

// A Wednesday, mid-year, mid-month.
const NOW = new Date("2026-07-01T15:30:00");

describe("periodRange", () => {
  test("day is the calendar day", () => {
    const p = periodRange("day", 0, NOW);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getDate()).toBe(1);
    expect(p.start.getHours()).toBe(0);
    expect(p.end.getHours()).toBe(23);
  });

  test("day back N", () => {
    const p = periodRange("day", 2, NOW);
    expect(p.start.getMonth()).toBe(5); // June
    expect(p.start.getDate()).toBe(29);
  });

  test("week runs Sun–Sat", () => {
    const p = periodRange("week", 0, NOW);
    expect(p.start.getDay()).toBe(0);
    expect(p.end.getDay()).toBe(6);
    expect(p.start <= NOW && NOW <= p.end).toBe(true);
  });

  test("month covers first to last day", () => {
    const p = periodRange("month", 0, NOW);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getDate()).toBe(31); // July has 31 days
    expect(p.end.getMonth()).toBe(6);
  });

  test("month back across year boundary", () => {
    const jan = new Date("2026-01-15T12:00:00");
    const p = periodRange("month", 1, jan);
    expect(p.start.getFullYear()).toBe(2025);
    expect(p.start.getMonth()).toBe(11); // December
    expect(p.end.getDate()).toBe(31);
  });

  test("year covers Jan 1 to Dec 31", () => {
    const p = periodRange("year", 0, NOW);
    expect(p.start.getMonth()).toBe(0);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getMonth()).toBe(11);
    expect(p.end.getDate()).toBe(31);
  });

  test("february end is handled", () => {
    const mar = new Date("2026-03-10T12:00:00");
    const p = periodRange("month", 1, mar);
    expect(p.end.getMonth()).toBe(1);
    expect(p.end.getDate()).toBe(28); // Feb 2026
  });
});

describe("periodLabel", () => {
  test("labels per unit", () => {
    expect(periodLabel("month", periodRange("month", 0, NOW))).toBe("Jul 2026");
    expect(periodLabel("year", periodRange("year", 0, NOW))).toBe("2026");
  });
});
