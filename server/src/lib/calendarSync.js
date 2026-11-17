/**
 * Component: Calendar subscriptions (ICS links and CalDAV accounts), read-only
 * Documentation: documentation/backend/services/calendar-sync.md
 *
 * A subscribed calendar's events are fetched from the server it names and
 * stored as ordinary rows; recurring events are expanded into occurrences
 * inside a window around today, so the app needs no recurrence engine for them.
 */
import ical from "node-ical";

const DAY = 86_400_000;
const PAST_DAYS = 90;
const FUTURE_DAYS = 400;
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_OCCURRENCES = 1500;

export class SyncError extends Error {}

/** webcal(s):// is http(s):// with a different name. Anything else is refused. */
export function normalizeUrl(raw) {
  let text = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcal/i, "http");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new SyncError("That is not a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SyncError("Use an http(s) or webcal address.");
  // The server fetches on the person's behalf: keep it off its own loopback and cloud metadata addresses.
  const host = url.hostname.toLowerCase();
  if (process.env.NOTIENT_ALLOW_LOCAL_FEEDS !== "1" && (host === "localhost" || /^127\./.test(host) || host === "[::1]" || host === "0.0.0.0" || /^169\.254\./.test(host))) {
    throw new SyncError("That address is not allowed.");
  }
  return url.toString();
}

const basic = (username, password) =>
  username ? { Authorization: `Basic ${Buffer.from(`${username}:${password || ""}`).toString("base64")}` } : {};

async function request(url, { method = "GET", headers = {}, body, username, password } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "User-Agent": "Notient", ...basic(username, password), ...headers },
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e) => {
    throw new SyncError(`Could not reach the server (${e.cause?.code || e.name || "network"}).`);
  });
  if (res.status === 401 || res.status === 403) throw new SyncError("The server refused the username or password.");
  if (res.status === 404) throw new SyncError("The server has nothing at that address.");
  if (res.status >= 400) throw new SyncError(`The server answered ${res.status}.`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new SyncError("The calendar is too large.");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new SyncError("The calendar is too large.");
  return { text, status: res.status, url: res.url };
}

const windowOf = (now) => [new Date(now - PAST_DAYS * DAY), new Date(now + FUTURE_DAYS * DAY)];

const plain = (v) => (v && typeof v === "object" && "val" in v ? v.val : v);

const rowOf = (ev, start, end, suffix) => ({
  externalId: `${ev.uid || ev.summary}${suffix}`,
  title: String(plain(ev.summary) || "Untitled").slice(0, 500),
  description: plain(ev.description) ? String(plain(ev.description)).slice(0, 8000) : "",
  location: plain(ev.location) ? String(plain(ev.location)).slice(0, 500) : "",
  url: ev.url ? String(plain(ev.url)).slice(0, 2000) : "",
  allDay: ev.datetype === "date",
  startTime: start.getTime(),
  endTime: end.getTime(),
});

/** VEVENTs of a parsed calendar as rows: recurrences expanded inside the window, overrides and exceptions honoured. */
export function eventsFrom(parsed, now = Date.now()) {
  const [from, to] = windowOf(now);
  const rows = [];
  for (const ev of Object.values(parsed)) {
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + (ev.datetype === "date" ? DAY : 3_600_000));
    const length = Math.max(end.getTime() - start.getTime(), 0);
    if (!ev.rrule) {
      if (end >= from && start <= to) rows.push(rowOf(ev, start, end, ""));
      continue;
    }
    const skipped = new Set(Object.values(ev.exdate || {}).map((d) => new Date(d).getTime()));
    const overrides = ev.recurrences || {};
    let dates = [];
    try {
      dates = ev.rrule.between(new Date(from.getTime() - length), to, true).slice(0, MAX_OCCURRENCES);
    } catch {
      dates = [];
    }
    for (const date of dates) {
      if (skipped.has(date.getTime())) continue;
      const override = Object.values(overrides).find((o) => o.recurrenceid && new Date(o.recurrenceid).getTime() === date.getTime());
      if (override) {
        const os = new Date(override.start);
        const oe = override.end ? new Date(override.end) : new Date(os.getTime() + length);
        rows.push(rowOf({ ...ev, ...override }, os, oe, `@${date.getTime()}`));
      } else {
        rows.push(rowOf(ev, date, new Date(date.getTime() + length), `@${date.getTime()}`));
      }
    }
  }
  return rows;
}

async function parse(text) {
  try {
    return await ical.async.parseICS(text);
  } catch {
    throw new SyncError("That is not a calendar (ICS) file.");
  }
}

/** An ICS link (iCloud public calendar, Google "secret address in iCal format", Outlook publish link, ...). */
export async function fetchIcs(rawUrl, { username, password } = {}, now = Date.now()) {
  const { text } = await request(normalizeUrl(rawUrl), { username, password });
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new SyncError("That address is not a calendar (ICS) feed.");
  return eventsFrom(await parse(text), now);
}

// --- CalDAV (read-only): discovery and a time-range REPORT --------------------------------------------------

const decodeXml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#13;/g, "\r")
    .replace(/&amp;/g, "&");

const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi"))].map((m) => m[1]);
const first = (xml, tag) => blocks(xml, tag)[0];
const hrefIn = (xml, tag) => {
  const inner = first(xml, tag);
  const href = inner && first(inner, "href");
  return href ? decodeXml(href).trim() : "";
};

const propfind = (url, body, auth, depth) =>
  request(url, { method: "PROPFIND", headers: { Depth: String(depth), "Content-Type": "application/xml; charset=utf-8" }, body, ...auth });

const abs = (base, href) => new URL(href, base).toString();

/** The calendars of a CalDAV account: [{ url, name, color }]. `url` may be the server, a principal or a calendar itself. */
export async function discoverCaldav(rawUrl, auth) {
  const start = normalizeUrl(rawUrl);
  const ns = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
  // 1. Is the address already a calendar (or a calendar home)? List what it holds at depth 1.
  const list = (u) =>
    propfind(
      u,
      `<?xml version="1.0"?><d:propfind ${ns} xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/></d:prop></d:propfind>`,
      auth,
      1,
    );
  const collect = (xml, base) => {
    const found = [];
    for (const response of blocks(xml, "response")) {
      if (!/<(?:\w+:)?calendar\b/i.test(first(response, "resourcetype") || "")) continue;
      const href = hrefIn(response, "href") || decodeXml(first(response, "href") || "").trim();
      if (!href) continue;
      const name = decodeXml(first(response, "displayname") || "").trim() || "Calendar";
      const color = decodeXml(first(response, "calendar-color") || "").trim().slice(0, 7);
      found.push({ url: abs(base, href), name, color: /^#[0-9a-f]{6}$/i.test(color) ? color : "" });
    }
    return found;
  };
  let res = await list(start);
  let found = collect(res.text, res.url || start);
  if (found.length) return found;
  // 2. Find the account's principal, then its calendar home.
  const principalRes = await propfind(start, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`, auth, 0);
  const principal = hrefIn(principalRes.text, "current-user-principal");
  if (!principal) throw new SyncError("The server did not say where this account's calendars are.");
  const principalUrl = abs(principalRes.url || start, principal);
  const homeRes = await propfind(principalUrl, `<?xml version="1.0"?><d:propfind ${ns}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`, auth, 0);
  const home = hrefIn(homeRes.text, "calendar-home-set");
  if (!home) throw new SyncError("The server did not list a calendar home.");
  const homeUrl = abs(homeRes.url || principalUrl, home);
  res = await list(homeUrl);
  found = collect(res.text, res.url || homeUrl);
  if (!found.length) throw new SyncError("No calendars were found on that account.");
  return found;
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** The events of one CalDAV calendar collection inside the sync window. */
export async function fetchCaldav(collectionUrl, auth, now = Date.now()) {
  const [from, to] = windowOf(now);
  // Recurring events are fetched by their master (no expand), then expanded here with the same rules as an ICS feed.
  const body = `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${stamp(from)}" end="${stamp(to)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
  const res = await request(normalizeUrl(collectionUrl), { method: "REPORT", headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body, ...auth });
  const rows = [];
  for (const data of blocks(res.text, "calendar-data")) {
    const text = decodeXml(data);
    if (!/BEGIN:VCALENDAR/i.test(text)) continue;
    rows.push(...eventsFrom(await parse(text), now));
  }
  return rows;
}

/** Fetch a stored calendar's events by its kind. */
export async function fetchFor(calendar, now = Date.now()) {
  const auth = { username: calendar.username || "", password: calendar.password || "" };
  return calendar.syncKind === "caldav" ? fetchCaldav(calendar.url, auth, now) : fetchIcs(calendar.url, auth, now);
}

/** Sync one stored calendar: replaces its events, or records the reason it could not. Never throws. */
export async function syncCalendarById(repos, id, now = Date.now()) {
  const calendar = await repos.calendars.getCalendar(id);
  if (!calendar || !calendar.syncKind) return { ok: false, error: "Not a subscribed calendar." };
  try {
    const events = await fetchFor(calendar, now);
    repos.calendars.replaceSynced(id, events, null);
    return { ok: true, count: events.length };
  } catch (e) {
    const message = e instanceof SyncError ? e.message : "The calendar could not be read.";
    repos.calendars.replaceSynced(id, [], message);
    return { ok: false, error: message };
  }
}
