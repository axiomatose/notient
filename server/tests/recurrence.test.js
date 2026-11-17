import { describe, it, expect } from "vitest";
import { nextDueAt, normalizeRecurrence } from "../src/lib/recurrence.js";

const at = (y, m, d, h = 9) => Date.UTC(y, m - 1, d, h);

describe("recurrence", () => {
  it("normalizes unknown and none to null", () => {
    expect(normalizeRecurrence("none")).toBeNull();
    expect(normalizeRecurrence("hourly")).toBeNull();
    expect(normalizeRecurrence("weekly")).toBe("weekly");
  });

  it("steps daily, weekly, weekdays, monthly and yearly", () => {
    const now = at(2000, 1, 1);
    expect(nextDueAt(at(2099, 1, 10), "daily", now)).toBe(at(2099, 1, 11));
    expect(nextDueAt(at(2099, 1, 10), "weekly", now)).toBe(at(2099, 1, 17));
    expect(nextDueAt(at(2099, 1, 10), "monthly", now)).toBe(at(2099, 2, 10));
    expect(nextDueAt(at(2099, 1, 10), "yearly", now)).toBe(at(2100, 1, 10));
  });

  it("skips Saturday and Sunday for weekdays", () => {
    const now = at(2000, 1, 1);
    // 2099-01-09 is a Friday.
    expect(new Date(at(2099, 1, 9)).getUTCDay()).toBe(5);
    expect(nextDueAt(at(2099, 1, 9), "weekdays", now)).toBe(at(2099, 1, 12));
  });

  it("clamps the day to the end of a shorter month", () => {
    const now = at(2000, 1, 1);
    expect(nextDueAt(at(2026, 1, 31), "monthly", now)).toBe(at(2026, 2, 28));
    expect(nextDueAt(at(2028, 2, 29), "yearly", now)).toBe(at(2029, 2, 28));
  });

  it("lands on the next occurrence still in the future", () => {
    const now = at(2026, 1, 5, 12);
    expect(nextDueAt(at(2026, 1, 1), "daily", now)).toBe(at(2026, 1, 6));
  });
});
