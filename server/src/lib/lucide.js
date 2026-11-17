/**
 * Component: Lucide icon lookup (SVG shapes to path data)
 * Documentation: documentation/frontend/pages/tasks/tasks.md
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ICON_DIR = fileURLToPath(
  new URL("../../node_modules/lucide-static/icons/", import.meta.url),
);
const NAME_PATTERN = /^[a-z0-9-]{1,48}$/;
const SHAPE_PATTERN =
  /<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g;
const ATTR_PATTERN = /([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g;

let iconNameCache = null;

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAttrs(source) {
  const attrs = {};
  for (const match of source.matchAll(ATTR_PATTERN)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function points(value) {
  const nums = (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const pairs = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pairs.push([nums[i], nums[i + 1]]);
  }
  return pairs;
}

function polyPath(pairs, close) {
  if (pairs.length === 0) {
    return null;
  }
  const [first, ...rest] = pairs;
  const segments = [`M${first[0]} ${first[1]}`];
  for (const [x, y] of rest) {
    segments.push(`L${x} ${y}`);
  }
  if (close) {
    segments.push("Z");
  }
  return segments.join(" ");
}

function ellipsePath(cx, cy, rx, ry) {
  if (rx <= 0 || ry <= 0) {
    return null;
  }
  return [
    `M${cx - rx} ${cy}`,
    `A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
    `A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
    "Z",
  ].join(" ");
}

function rectPath(x, y, width, height, rxAttr, ryAttr) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const hasRx = rxAttr !== undefined;
  const hasRy = ryAttr !== undefined;
  const rxIn = Math.max(hasRx ? num(rxAttr) : num(ryAttr), 0);
  let rx;
  let ry;
  if (hasRy) {
    rx = Math.min(rxIn, width / 2);
    ry = Math.min(Math.max(num(ryAttr), 0), height / 2);
  } else {
    // Single radius: keep corners circular.
    rx = Math.min(rxIn, width / 2, height / 2);
    ry = rx;
  }

  if (rx === 0 || ry === 0) {
    return `M${x} ${y} H${x + width} V${y + height} H${x} Z`;
  }
  const right = x + width;
  const bottom = y + height;
  return [
    `M${x + rx} ${y}`,
    `H${right - rx}`,
    `A${rx} ${ry} 0 0 1 ${right} ${y + ry}`,
    `V${bottom - ry}`,
    `A${rx} ${ry} 0 0 1 ${right - rx} ${bottom}`,
    `H${x + rx}`,
    `A${rx} ${ry} 0 0 1 ${x} ${bottom - ry}`,
    `V${y + ry}`,
    `A${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
    "Z",
  ].join(" ");
}

/**
 * Convert one SVG shape element to a path `d` string (null when degenerate).
 * @param {string} tag  path | circle | ellipse | rect | line | polyline | polygon
 * @param {Record<string, string>} attrs  raw attribute map
 */
export function shapeToPath(tag, attrs) {
  switch (tag) {
    case "path":
      return attrs.d ? attrs.d.trim() : null;
    case "circle": {
      const r = num(attrs.r);
      return ellipsePath(num(attrs.cx), num(attrs.cy), r, r);
    }
    case "ellipse":
      return ellipsePath(
        num(attrs.cx),
        num(attrs.cy),
        num(attrs.rx),
        num(attrs.ry),
      );
    case "rect":
      return rectPath(
        num(attrs.x),
        num(attrs.y),
        num(attrs.width),
        num(attrs.height),
        attrs.rx,
        attrs.ry,
      );
    case "line":
      return `M${num(attrs.x1)} ${num(attrs.y1)} L${num(attrs.x2)} ${num(attrs.y2)}`;
    case "polyline":
      return polyPath(points(attrs.points), false);
    case "polygon":
      return polyPath(points(attrs.points), true);
    default:
      return null;
  }
}

/**
 * Return path `d` strings for every shape in a Lucide icon, or null when the
 * name is invalid or the icon does not exist.
 * @param {string} name  e.g. "star"
 * @returns {string[] | null}
 */
export function lucideShapes(name) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    return null;
  }
  const file = `${ICON_DIR}${name}.svg`;
  if (!existsSync(file)) {
    return null;
  }
  const svg = readFileSync(file, "utf8");
  const paths = [];
  for (const match of svg.matchAll(SHAPE_PATTERN)) {
    const d = shapeToPath(match[1], parseAttrs(match[2]));
    if (d) {
      paths.push(d);
    }
  }
  return paths;
}

function iconNames() {
  if (!iconNameCache) {
    iconNameCache = readdirSync(ICON_DIR)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => file.slice(0, -4))
      .sort();
  }
  return iconNameCache;
}

/**
 * Icon names containing `query` (prefix matches first), at most `limit`.
 * @returns {string[]}
 */
export function searchLucideIcons(query, limit = 24) {
  const needle = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!needle) {
    return [];
  }
  const prefix = [];
  const contains = [];
  for (const name of iconNames()) {
    if (name.startsWith(needle)) {
      prefix.push(name);
    } else if (name.includes(needle)) {
      contains.push(name);
    }
    if (prefix.length >= limit) {
      break;
    }
  }
  return [...prefix, ...contains].slice(0, limit);
}
