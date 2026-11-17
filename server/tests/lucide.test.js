import { describe, it, expect } from "vitest";
import { shapeToPath } from "../src/lib/lucide.js";

describe("lucide shape conversion", () => {
  it("converts a rect without rounding to a closed path", () => {
    expect(
      shapeToPath("rect", { x: "3", y: "4", width: "18", height: "10" }),
    ).toBe("M3 4 H21 V14 H3 Z");
  });

  it("converts a rounded rect using arcs and clamps radius to half the size", () => {
    const d = shapeToPath("rect", {
      x: "2",
      y: "2",
      width: "20",
      height: "10",
      rx: "2",
    });
    expect(d.startsWith("M4 2")).toBe(true);
    expect(d.match(/A2 2 0 0 1/g)).toHaveLength(4);
    expect(d.endsWith("Z")).toBe(true);

    const clamped = shapeToPath("rect", {
      x: "0",
      y: "0",
      width: "10",
      height: "4",
      rx: "99",
    });
    expect(clamped).toContain("A2 2 0 0 1 10 2");
  });

  it("converts a circle to two arcs around its center", () => {
    expect(shapeToPath("circle", { cx: "12", cy: "12", r: "10" })).toBe(
      "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12 Z",
    );
  });

  it("returns null for degenerate circles and rects", () => {
    expect(shapeToPath("circle", { cx: "1", cy: "1", r: "0" })).toBeNull();
    expect(
      shapeToPath("rect", { x: "0", y: "0", width: "0", height: "5" }),
    ).toBeNull();
  });

  it("converts line, polyline and polygon", () => {
    expect(
      shapeToPath("line", { x1: "1", y1: "2", x2: "3", y2: "4" }),
    ).toBe("M1 2 L3 4");
    expect(shapeToPath("polyline", { points: "1,2 3,4 5,6" })).toBe(
      "M1 2 L3 4 L5 6",
    );
    expect(shapeToPath("polygon", { points: "1 2 3 4 5 6" })).toBe(
      "M1 2 L3 4 L5 6 Z",
    );
  });
});
