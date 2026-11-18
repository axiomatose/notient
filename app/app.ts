// Notient's data module: the repo's Express API (server.ts runs it for test
// and verify; .env.local's API_BASE_URL points real builds at a deployment).
import type { Answer, Overlay, Result, Sources, Storage, StreamEvent } from './app.contract.d.ts';

const origin = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
export const API = origin;
// A self-hoster's own server, kept on the device (sign-in page); the build's address is the default.
const kept = (store: unknown): string => {
  const v = (store as { get?(k: string): unknown } | undefined)?.get?.('server');
  return typeof v === 'string' ? v : '';
};
// Servers typed before (the build's own is not listed): kept as a JSON array beside the current one.
const savedOf = (store: unknown): string[] => {
  try {
    const v = (store as { get?(k: string): unknown } | undefined)?.get?.('servers');
    const a: unknown = typeof v === 'string' && v !== '' ? JSON.parse(v) : [];
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const originOf = (store: unknown): string => kept(store) || origin;
// The live channel's address: .env.local's SOCKET_URL (ws:// or wss:// with the API's host); build and test use the loopback default.
const SOCKET = import.meta.env.SOCKET_URL ?? 'ws://127.0.0.1:8787';
// The server's address is the person's to choose (their own domain, a LAN box), so the grants name schemes.
// The build's own address is granted too where tools need it (dev, test); the published web bundle is built
// with a placeholder address and no address grant, because a grant naming it is sealed by the build and the
// server swaps that address for its own at start (server/src/lib/webBundle.js).
// App Transport Security still refuses plain http beyond the local network on Apple platforms.
export const grants = {
  'http://127.0.0.1:8787': [
    'net.fetch http://127.0.0.1:8787',
    'net.websocket ws://127.0.0.1:8787',
    'net.fetch https:',
    'net.fetch http:',
    'device.local-network lanPurpose',
    'net.fetch local-network',
    'net.websocket wss:',
    'net.websocket ws:',
    'net.websocket local-network',
    'secret.keep server',
    'secret.keep servers',
    'secret.keep token',
    'secret.keep name',
    'secret.keep email',
    'secret.keep appearance',
    'secret.keep boards',
    'fs.read app:/data/notes-cache.json',
    'fs.write app:/data/notes-cache.json',
    'fs.read app:/tmp/picked',
  ],
  'https://notient-placeholder.invalid': [
    'net.fetch https:',
    'net.fetch http:',
    'device.local-network lanPurpose',
    'net.fetch local-network',
    'net.websocket wss:',
    'net.websocket ws:',
    'net.websocket local-network',
    'secret.keep server',
    'secret.keep servers',
    'secret.keep token',
    'secret.keep name',
    'secret.keep email',
    'secret.keep appearance',
    'secret.keep boards',
    'fs.read app:/data/notes-cache.json',
    'fs.write app:/data/notes-cache.json',
    'fs.read app:/tmp/picked',
  ],
  'https://notes.vanceprop.com': [
    'net.fetch https:',
    'net.fetch http:',
    'device.local-network lanPurpose',
    'net.fetch local-network',
    'net.websocket wss:',
    'net.websocket ws:',
    'net.websocket local-network',
    'secret.keep server',
    'secret.keep servers',
    'secret.keep token',
    'secret.keep name',
    'secret.keep email',
    'secret.keep appearance',
    'secret.keep boards',
    'fs.read app:/data/notes-cache.json',
    'fs.write app:/data/notes-cache.json',
    'fs.read app:/tmp/picked',
  ],
};


// The native runtime has no FormData/Blob: build the multipart body as bytes.
const ascii = (t: string): number[] => Array.from(t, (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 95));
const multipart = (fields: [string, string][], file: { field: string; name: string; type: string; bytes: ArrayBuffer }) => {
  const boundary = '----notient-boundary-7f3a9c2e5b81d4a6'; // fixed: no clock or random in data sources
  const out: number[] = [];
  for (const [k, v] of fields) out.push(...ascii(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  out.push(...ascii(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name.replace(/["\\r\n]/g, '_')}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  const head = new Uint8Array(out);
  const data = new Uint8Array(file.bytes);
  const tail = new Uint8Array(ascii(`\r\n--${boundary}--\r\n`));
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return { body: body.buffer as ArrayBuffer, contentType: `multipart/form-data; boundary=${boundary}` };
};

const liveTickets = new Map<number, string>();
let liveAttempt = 0;
let liveTicks = 0;
// True while the live socket is open: only then can a stored answer be trusted, because the server says when something changed.
let liveOpen = false;

const OFFLINE = 'Can’t reach the server. Check your connection and try again.';
type Answered = { ok: true; body: unknown } | { ok: false; error: string };
// GET answers, by server, token and path. Concurrent asks for one path share a single request (a board's four
// loaders ask the same address); while the live socket is open a good answer is reused. A data source has no clock,
// so the socket is the limit: it is reopened (and this emptied) whenever it closes or idles out.
// Any write, any live message, a closed socket, a new sign-in or a new server empties it, in-flight asks included,
// so a request that began before a write is never handed out after it. Only paths the server announces changes to are kept
// (see WATCHED in server/src/lib/liveHub.js); the rest, calendars and notifications, always go to the network.
const WATCHED = /^\/(tasks|task-sections|task-lists|task-list-shares|task-attachments|notes|note-shares)(\/|\?|$)/;
const answers = new Map<string, { promise: Promise<Answered>; done: boolean; ok: boolean }>();
const forgetAnswers = (): void => {
  answers.clear();
};

async function call(store: unknown, path: string, init: RequestInit = {}): Promise<Answered> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    forgetAnswers();
    try {
      return await request(store, path, init);
    } finally {
      forgetAnswers(); // a read begun while the write was in flight may have seen the old data
    }
  }
  if (!WATCHED.test(path)) return request(store, path, init);
  const key = `${originOf(store)}\n${bearer(store)}\n${path}`;
  const held = answers.get(key);
  if (held && (!held.done || (held.ok && liveOpen))) return held.promise;
  const entry = { promise: request(store, path, init), done: false, ok: false };
  answers.set(key, entry);
  entry.promise.then(
    (a) => {
      entry.done = true;
      entry.ok = a.ok;
      if (!a.ok && answers.get(key) === entry) answers.delete(key);
    },
    () => {
      if (answers.get(key) === entry) answers.delete(key);
    },
  );
  return entry.promise;
}

async function request(store: unknown, path: string, init: RequestInit = {}): Promise<Answered> {
  const token = typeof store === 'object' && store !== null ? (store as { get(k: string): unknown }).get('token') : '';
  try {
    const res = await fetch(`${originOf(store)}${path}`, {
      ...init,
      exactTimeout: (init as { exactTimeout?: number }).exactTimeout ?? 10000,
      headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, body };
    const message = (body as { error?: unknown; message?: unknown });
    const code = typeof message.error === 'string' ? message.error : '';
    if (code === 'invalid_credentials' || code === 'user_not_found' || code === 'invalid_token') return { ok: false, error: 'Wrong email or password.' };
    if (res.status === 401) {
      // The server does not know this login any more (account removed, token expired, database reset): forget it, and the
      // session read after the next live retry puts the app back on sign-in.
      if (typeof token === 'string' && token !== '') {
        const s = store as Store;
        s.set('token', '');
        s.set('name', '');
        s.set('email', '');
        forgetAnswers();
      }
      return { ok: false, error: 'Sign in again.' };
    }
    if (typeof message.message === 'string' && message.message) return { ok: false, error: message.message };
    return { ok: false, error: friendly(code) };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e; // no server at build
    return { ok: false, error: OFFLINE };
  }
}

// One request answers a board: its sections, tasks, every task's subtasks and the people on the list.
// loadTasks, loadBoardSubtasks, loadSections and loadMembers each read it; `call` makes them share one fetch.
const boardOf = (store: unknown, listId: string): Promise<Answered> => callWith(store, `/tasks/board?listId=${encodeURIComponent(listId)}`);

const uploadNoteImageOne = async (noteId: string, name: string, path: string, mime: string, store: unknown, storage: Storage): Promise<{ ok: boolean; url: string; error: string }> => {
  try {
    let bytes: ArrayBuffer;
    try {
      bytes = await storage.fs.readFile(path);
    } catch {
      return { ok: false, url: '', error: 'Could not read the image. Try again.' };
    }
    const known = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    let type = known.includes(mime) ? mime : '';
    if (type === '') {
      const ext = name.split('.').at(-1) ?? '';
      type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    }
    const mp = multipart([['noteId', noteId]], { field: 'image', name, type, bytes });
    const res = await fetch(`${originOf(store)}/uploads/images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer(store)}`, 'content-type': mp.contentType },
      body: mp.body,
      exactTimeout: 30000,
    });
    if (!res.ok) return { ok: false, url: '', error: 'The image could not be uploaded. Try again.' };
    const url = String(((await res.json().catch(() => ({}))) as { file?: { url?: string } }).file?.url ?? '');
    if (url === '') return { ok: false, url: '', error: 'The image could not be uploaded. Try again.' };
    return { ok: true, url, error: '' };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e;
    return { ok: false, url: '', error: OFFLINE };
  }
};


const friendly = (code: string): string => {
  if (code === 'invalid_credentials' || code === 'user_not_found') return 'Wrong email or password.';
  if (code === 'email_in_use') return 'That email is already registered.';
  if (code === 'too_many_attempts') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'invalid_body' || code === 'invalid_query') return 'Check what you entered and try again.';
  return 'The server had a problem. Try again.';
};
const reply = (r: Answered) => (r.ok ? { ok: true, error: '' } : { ok: false, error: r.error });

// Fallback only: the API returns the raw Markdown as `bodyMarkdown`; HTML-only
// responses (older servers) are converted once at this seam.
const toMarkdown = (html: string): string => html
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
  .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
  .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
  .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
  .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
  .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n')
  .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
  .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)')
  .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
  .replace(/<(strong|b)\s*>([\s\S]*?)<\/\1>/gi, '**$2**')
  .replace(/<(em|i)\s*>([\s\S]*?)<\/\1>/gi, '*$2*')
  .replace(/<del\s*>([\s\S]*?)<\/del>/gi, '~~$1~~')
  .replace(/<pre\s*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, inner: string) => `\n\`\`\`\n${inner.replace(/^\n|\n$/g, '')}\n\`\`\`\n`)
  .replace(/<code\s*>([\s\S]*?)<\/code>/gi, '`$1`')
  .replace(/<hr\s*\/?>/gi, '\n---\n')
  .replace(/<blockquote\s*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => `${String(inner).trim().split('\n').map((l) => `> ${l.trim()}`).join('\n')}\n`)
  .replace(/<li\s*>([\s\S]*?)<\/li>/gi, '- $1\n')
  .replace(/<\/?(ul|ol)\s*>/gi, '\n')
  .replace(/<\/(p|div)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const markdownOf = (md: unknown, html: unknown): string =>
  typeof md === 'string' ? md : toMarkdown(String(html ?? ''));

type Store = { get(k: string): unknown; set(k: string, v: string): void };
const bearer = (store: unknown): string => {
  const token = (store as Store | undefined)?.get?.('token');
  return typeof token === 'string' ? token : '';
};
const who = (store: unknown): string => {
  const email = (store as Store | undefined)?.get?.('email');
  return typeof email === 'string' ? email : '';
};

type NoteBody = { id: string; title: string; body: string; bodyMarkdown?: unknown; isPinned?: boolean; updatedAt: number; tags?: unknown; folder?: string | null; deletedAt?: number | null; version?: number };
const isNoteBody = (v: unknown): v is NoteBody =>
  typeof v === 'object' && v !== null && typeof (v as NoteBody).id === 'string'
  && typeof (v as NoteBody).title === 'string' && typeof (v as NoteBody).body === 'string';
const tagsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);

type ListBody = { id: string; name: string; icon?: string | null; color?: string | null };
const isListBody = (v: unknown): v is ListBody =>
  typeof v === 'object' && v !== null && typeof (v as ListBody).id === 'string' && typeof (v as ListBody).name === 'string';

type TaskBody = { id: string; title: string; isDone: boolean; notes?: string | null; dueAt?: number | null; dueHasTime?: boolean; remindAt?: number | null; flagged?: boolean; recurrence?: string | null; url?: string | null; priority?: number | null; sectionId?: string | null; tags?: unknown; version?: number; sortOrder?: number | null; subtaskCount?: number; parentId?: string | null; assigneeId?: string | null; completedAt?: number | null };
const isTaskBody = (v: unknown): v is TaskBody =>
  typeof v === 'object' && v !== null && typeof (v as TaskBody).id === 'string'
  && typeof (v as TaskBody).title === 'string' && typeof (v as TaskBody).isDone === 'boolean';
// One task as the views read it. Times the person sees are cut here, in the device zone the
// editor parses them back in: dueDay "2026-11-20", dueTime "09:00" ("" when all-day), 0 for none.
const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
const clockOf = (ms: number, zone: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const taskRecord = (t: TaskBody, zone: string) => {
  const due = typeof t.dueAt === 'number' ? t.dueAt : 0;
  const timed = t.dueHasTime !== false;
  return { id: t.id, title: t.title, isDone: t.isDone, notes: t.notes ?? '', dueAt: due, dueDay: due === 0 ? '' : dayKey(due, zone), dueTime: due !== 0 && timed ? clockOf(due, zone) : '', dueHasTime: timed, remindAt: t.remindAt ?? 0, flagged: t.flagged === true, recurrence: t.recurrence ?? 'none', url: t.url ?? '', priority: t.priority ?? 0, tags: tagsOf(t.tags), sectionId: t.sectionId ?? '', version: typeof t.version === 'number' ? t.version : 0, sortOrder: t.sortOrder ?? 0, subtaskCount: t.subtaskCount ?? 0, parentId: t.parentId ?? '', assigneeId: t.assigneeId ?? '', completedAt: t.completedAt ?? 0 };
};

// A task's due date, time, reminder and repeat as the API takes them (create and update share it).
// Reminder: none, at the due time, or an hour / a day before it. 'keep' (a custom time) leaves remindAt as it is (undefined).
const dueBody = (dueDay: string, dueTime: string, reminder: string, recurrence: string): { error: string } | { dueAt: number | null; dueHasTime: boolean; remindAt?: number | null; recurrence: string | null } => {
  const day = dueDay.trim();
  const clock = dueTime.trim();
  const dueAt = day === '' ? 0 : Date.parse(`${day}T${clock === '' ? '09:00' : clock}:00`);
  if (day !== '' && !Number.isFinite(dueAt)) return { error: 'Enter the due date as YYYY-MM-DD.' };
  const due = dueAt === 0 ? null : dueAt;
  const before = reminder === '1h' ? 3600000 : reminder === '1d' ? 86400000 : 0;
  const remindAt = reminder === 'keep' ? undefined : due === null || reminder === 'none' ? null : due - before;
  return { dueAt: due, dueHasTime: clock !== '' && due !== null, remindAt, recurrence: due === null || recurrence === 'none' ? null : recurrence };
};

type EventBody = { id: string; title: string; startTime: number; endTime: number; allDay: boolean; location: string | null; description?: string | null; calendarId?: string; recurrence?: string | null; alertMinutes?: number | null; url?: string | null; attendees?: unknown };
const isEventBody = (v: unknown): v is EventBody =>
  typeof v === 'object' && v !== null && typeof (v as EventBody).id === 'string'
  && typeof (v as EventBody).title === 'string' && typeof (v as EventBody).startTime === 'number';

const dayKey = (ms: number, zone: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// The editor's repeat choices as the API's rrule (none: no rule).
const EVENT_REPEATS: Record<string, string> = { none: '', daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' };
// An event's start and end in the device zone (the editor's day and time strings). An all-day event runs
// from midnight of its start day to midnight after its end day; an end before the start is refused.
type EventSpan = { error: string } | { startTime: number; endTime: number };
const eventSpan = (allDay: boolean, startDay: string, startTime: string, endDay: string, endTime: string): EventSpan => {
  if (!Number.isFinite(Date.parse(`${startDay}T00:00:00`)) || !Number.isFinite(Date.parse(`${endDay}T00:00:00`))) return { error: 'Enter the dates as YYYY-MM-DD.' };
  if (allDay) {
    if (endDay < startDay) return { error: 'The event ends before it starts.' };
    const [y, m, d] = endDay.split('-').map(Number);
    const [sy, sm, sd] = startDay.split('-').map(Number);
    return { startTime: new Date(sy, sm - 1, sd).getTime(), endTime: new Date(y, m - 1, d + 1).getTime() };
  }
  const start = Date.parse(`${startDay}T${startTime}:00`);
  const end = Date.parse(`${endDay}T${endTime}:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'Enter the times as HH:MM.' };
  if (end < start) return { error: 'The event ends before it starts.' };
  return { startTime: start, endTime: end };
};
// The event fields the create and update requests share. Blank text is sent as null (cleared).
const eventFields = (title: string, notes: string, url: string, location: string, allDay: boolean, span: { startTime: number; endTime: number }, repeat: string, alert: string, attendees: string[]) => ({
  title: title.trim(),
  description: notes === '' ? null : notes,
  startTime: span.startTime,
  endTime: span.endTime,
  allDay,
  location: location.trim() === '' ? null : location.trim(),
  recurrence: EVENT_REPEATS[repeat] || null,
  alertMinutes: alert === 'none' ? null : Number(alert),
  url: url.trim() === '' ? null : url.trim(),
  attendees: attendees.filter((a) => a.includes('@')),
});

// The last good answer for the signed-in account, kept for a lost connection.
const CACHE = 'app:/data/notes-cache.json';
type NoteRow = Result<'loadNotes'>['notes'][number];
type Cached = { owner: string; notes: NoteRow[]; folders: string[]; tags: string[] };
async function readCache(storage: Storage, owner: string): Promise<Cached | null> {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await storage.fs.readFile(CACHE))) as Cached;
    if (parsed && parsed.owner === owner && Array.isArray(parsed.notes) && Array.isArray(parsed.folders) && Array.isArray(parsed.tags)) {
      return parsed;
    }
  } catch { /* no cache yet */ }
  return null;
}
async function writeCache(storage: Storage, answer: Cached): Promise<void> {
  try {
    await storage.fs.atomicWriteFile(CACHE, new TextEncoder().encode(JSON.stringify(answer)));
  } catch { /* the cache is best effort */ }
}
const dayLabel = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d, 12));
};
const timeLabel = (ms: number, zone: string): string => new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
// One event as the calendar and the sidebar read it: its start day, clock and span (minutes from the start day's midnight; past midnight it ends at 1440).
const eventRowOf = (ev: EventBody, zone: string): DayRow => {
  const from = new Date(ev.startTime);
  const to = new Date(ev.endTime);
  const key = dayKey(ev.startTime, zone);
  const startMin = from.getHours() * 60 + from.getMinutes();
  const endMin = dayKey(ev.endTime, zone) === key ? to.getHours() * 60 + to.getMinutes() : 1440;
  // The editor's day and clock strings: an all-day event's end day is its last day (the midnight after is its end).
  return { id: ev.id, title: ev.title, time: ev.allDay ? 'All day' : timeLabel(ev.startTime, zone), location: ev.location ?? '', description: ev.description ?? '', calendarId: ev.calendarId ?? '', allDay: ev.allDay, startTime: ev.startTime, endTime: ev.endTime, recurrence: ev.recurrence ?? '', attendees: tagsOf(ev.attendees), startMin, endMin, lane: 0, lanes: 1, startDay: key, startClock: clockOf(ev.startTime, zone), endDay: dayKey(ev.allDay ? ev.endTime - 1 : ev.endTime, zone), endClock: clockOf(ev.endTime, zone), url: ev.url ?? '', alertMinutes: ev.alertMinutes ?? -1, dayShort: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', timeZone: zone }).format(from) };
};

async function callWith(store: unknown, path: string, init?: RequestInit): Promise<Answered> {
  return call(store, path, init);
}

// Drag & drop placement: the moved row lands before `before` (or at the end). Its sortOrder is the
// midpoint of its new neighbours when that fits strictly between them; otherwise every row in the
// group is renumbered by STEP. The moved row always gets `extra` too (e.g. its section).
// Syntax colouring for fenced code blocks (language-agnostic: comments, strings, numbers, keywords, calls, types).
const KEYWORDS = new Set(('let const var function return if else for while do switch case break continue class extends implements interface type enum import export from as default new this super async await try catch finally throw typeof instanceof in of void null undefined true false def lambda None True False self elif except pass with yield not and or is fn mut pub struct impl trait use mod match loop func package go defer chan range static public private protected final abstract guard where some any init deinit override extension protocol typealias throws rethrows inout fi then done echo local readonly').split(' '));
const SQL_UPPER = new Set('SELECT FROM WHERE INSERT INTO VALUES UPDATE DELETE CREATE TABLE ALTER DROP JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER LIMIT AND OR NOT NULL AS SET PRIMARY KEY DEFAULT INDEX UNIQUE'.split(' '));
type CodeTok = { i: number; t: string; k: string };
function tokenizeCode(code: string): CodeTok[] {
  const src = code.slice(0, 20000);
  const out: CodeTok[] = [];
  const push = (t: string, k: string) => {
    const last = out[out.length - 1];
    if (last && last.k === k && (k === 'plain' || k === 'com')) last.t += t;
    else out.push({ i: out.length, t, k });
  };
  const isIdent = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const prev = src[i - 1];
    if (src.startsWith('//', i) || (c === '#' && (i === 0 || prev === '\n' || prev === ' ' || prev === '\t'))) {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      push(src.slice(i, j), 'com');
      i = j;
    } else if (src.startsWith('/*', i)) {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? src.length : j + 2;
      push(src.slice(i, j), 'com');
      i = j;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      j = Math.min(src.length, j + 1);
      push(src.slice(i, j), 'str');
      i = j;
    } else if (/[0-9]/.test(c) && !isIdent(prev)) {
      let j = i + 1;
      while (j < src.length && /[0-9a-fA-FxX._]/.test(src[j])) j += 1;
      push(src.slice(i, j), 'num');
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j += 1;
      const word = src.slice(i, j);
      let k = 'plain';
      if (KEYWORDS.has(word) || SQL_UPPER.has(word)) k = 'kw';
      else if (/^[ \t]*\(/.test(src.slice(j, j + 8))) k = 'fn';
      else if (/^[A-Z]/.test(word)) k = 'type';
      push(word, k);
      i = j;
    } else {
      push(c, 'plain');
      i += 1;
    }
  }
  return out;
}
// The fenced blocks of a note body, each with the text NoteBlocks shows for it and its tokens.
function highlightBlocks(body: string): { text: string; tokens: CodeTok[] }[] {
  const lines = body.split('\n');
  const blocks: { text: string; tokens: CodeTok[] }[] = [];
  const add = (text: string) => {
    if (!blocks.some((b) => b.text === text)) blocks.push({ text, tokens: tokenizeCode(text) });
  };
  let open: string[] | null = null;
  for (const line of lines) {
    const fence = line.trim().startsWith('```');
    if (open === null) {
      if (fence) open = [];
    } else if (fence) {
      add(open.join('\n'));
      open = null;
    } else open.push(line);
  }
  if (open !== null) add(open.join('\n'));
  return blocks;
}
const STEP = 1024;
type Ordered = { id: string; sortOrder?: number | null };
async function placeRow(store: unknown, base: string, rows: Ordered[], id: string, before: string, extra: Record<string, unknown>): Promise<{ ok: boolean; error: string }> {
  const sorted = rows.map((r) => ({ id: r.id, order: r.sortOrder ?? 0 })).sort((a, b) => a.order - b.order);
  const others = sorted.filter((r) => r.id !== id);
  const found = before === '' ? -1 : others.findIndex((r) => r.id === before);
  const index = found < 0 ? others.length : found;
  const prev = others[index - 1]?.order;
  const next = others[index]?.order;
  let mid: number;
  if (prev === undefined && next === undefined) mid = 0;
  else if (next === undefined) mid = (prev as number) + STEP;
  else if (prev === undefined) mid = next - STEP;
  else mid = (prev + next) / 2;
  const fits = (prev === undefined || mid > prev) && (next === undefined || mid < next);
  const updates: [string, Record<string, unknown>][] = [];
  if (fits) {
    updates.push([id, { sortOrder: mid, ...extra }]);
  } else {
    const order = [...others.slice(0, index), { id, order: 0 }, ...others.slice(index)];
    order.forEach((row, position) => {
      const wanted = position * STEP;
      if (row.id === id) updates.push([id, { sortOrder: wanted, ...extra }]);
      else if (row.order !== wanted) updates.push([row.id, { sortOrder: wanted }]);
    });
  }
  for (const [rowId, data] of updates) {
    const p = await callWith(store, `${base}/${encodeURIComponent(rowId)}`, { method: 'PATCH', body: JSON.stringify(data) });
    if (!p.ok) return { ok: false, error: p.error };
  }
  return { ok: true, error: '' };
}

const exactTimeSource = async () => ({
  epochAtZero: performance.timeOrigin,
  utcOffset: -new Date(performance.timeOrigin).getTimezoneOffset(),
});

// One event of a day as the view reads it: minutes from midnight (device zone) and its lane.
type DayRow = { id: string; title: string; time: string; location: string; description: string; calendarId: string; allDay: boolean; startTime: number; endTime: number; recurrence: string; attendees: string[]; startMin: number; endMin: number; lane: number; lanes: number; startDay: string; startClock: string; endDay: string; endClock: string; url: string; alertMinutes: number; dayShort: string };

// Timed events in lanes: each takes the lowest lane free at its start (blocks are at least 30 minutes
// tall, as drawn), and a cluster of overlapping events shares as many lanes as its busiest moment needs.
function layoutDay(rows: DayRow[]): void {
  const timed = rows.filter((r) => !r.allDay).sort((a, b) => a.startMin - b.startMin);
  let cluster: DayRow[] = [];
  let clusterEnd = 0;
  const laneEnds: number[] = [];
  const closeCluster = () => {
    for (const r of cluster) r.lanes = laneEnds.length;
    cluster = [];
    laneEnds.length = 0;
  };
  for (const r of timed) {
    if (cluster.length > 0 && r.startMin >= clusterEnd) closeCluster();
    const end = Math.max(r.endMin, r.startMin + 30);
    let lane = laneEnds.findIndex((e) => e <= r.startMin);
    if (lane < 0) lane = laneEnds.push(end) - 1;
    else laneEnds[lane] = end;
    r.lane = lane;
    cluster.push(r);
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();
}

const lucideCache = new Map<string, { name: string; paths: string[] }>();

const sources: Sources = {
  loadSession: (_args: [], store: Store) => {
    const token = bearer(store);
    return { signedIn: token !== '', name: String((store as Store).get('name') ?? ''), email: who(store) };
  },
  signIn: async ([email, password], store) => {
    const r = await callWith(store, '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, rememberMe: true }) });
    if (!r.ok) return reply(r);
    const b = r.body as { token: string; user: { email: string; displayName: string | null } };
    forgetAnswers();
    (store as Store).set('token', b.token);
    (store as Store).set('name', b.user.displayName ?? b.user.email.split('@')[0]);
    (store as Store).set('email', b.user.email);
    return { ok: true, error: '' };
  },
  register: async ([email, password, name], store) => {
    const body: Record<string, string> = { email, password };
    if (name.trim() !== '') body.name = name.trim();
    const r = await callWith(store, '/auth/register', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) return reply(r);
    const b = r.body as { token: string; user: { email: string; displayName: string | null } };
    forgetAnswers();
    (store as Store).set('token', b.token);
    (store as Store).set('name', b.user.displayName ?? (name.trim() !== '' ? name.trim() : b.user.email.split('@')[0]));
    (store as Store).set('email', b.user.email);
    return { ok: true, error: '' };
  },
  loadServer: (_args, store): Result<'loadServer'> => ({ server: kept(store), fallback: origin, saved: savedOf(store) }),
  // Blank returns to the build's server. Signing out is the caller's: a token belongs to one server.
  saveServer: ([url], store): Result<'saveServer'> => {
    const v = url.trim().replace(/\/+$/, '');
    if (v !== '' && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(v)) return { ok: false, error: 'Use an address like https://notes.example.com.' };
    forgetAnswers();
    (store as Store).set('server', v);
    // A new address is remembered, so it can be picked again from the list.
    const saved = savedOf(store);
    if (v !== '' && v !== origin && !saved.includes(v)) (store as Store).set('servers', JSON.stringify([...saved, v]));
    (store as Store).set('token', '');
    (store as Store).set('name', '');
    (store as Store).set('email', '');
    return { ok: true, error: '' };
  },
  signOut: (_args, store) => {
    forgetAnswers();
    (store as Store).set('token', '');
    (store as Store).set('name', '');
    (store as Store).set('email', '');
    return { ok: true, error: '' };
  },
  loadNotes: async (_args, store, storage): Promise<Result<'loadNotes'>> => {
    const owner = who(store);
    if (owner === '') return { owner, notes: [], folders: [], tags: [], stale: false };
    const r = await callWith(store, '/notes?includeDeleted=true');
    if (!r.ok) {
      if (r.error === OFFLINE) {
        const cached = await readCache(storage, owner);
        if (cached) return { ...cached, stale: true };
      }
      throw new Error(r.error);
    }
    const body = r.body as { notes?: unknown };
    if (!Array.isArray(body.notes) || !body.notes.every(isNoteBody)) throw new Error('The server returned an invalid note list.');
    // Pinned first, then the most recently updated: the order the list relies on.
    const notes = body.notes
      .map((n) => ({ id: n.id, title: n.title, body: markdownOf(n.bodyMarkdown, n.body), isPinned: n.isPinned === true, tags: tagsOf(n.tags), folder: n.folder ?? '', updatedAt: n.updatedAt, deletedAt: n.deletedAt ?? 0, version: typeof n.version === 'number' ? n.version : 0 }))
      .sort((a, b) => (a.isPinned === b.isPinned ? b.updatedAt - a.updatedAt : a.isPinned ? -1 : 1));
    const folders = [...new Set(notes.filter((n) => n.folder !== '' && n.deletedAt === 0).map((n) => n.folder))].sort();
    const tags = [...new Set(notes.filter((n) => n.deletedAt === 0).flatMap((n) => n.tags))].sort();
    const answer = { owner, notes, folders, tags };
    await writeCache(storage, answer);
    return { ...answer, stale: false };
  },
  // A new note keeps the folder, tags and pin chosen before its first save.
  createNoteDraft: async ([title, body, folder, tags, isPinned], store) => {
    const r = await callWith(store, '/notes', { method: 'POST', body: JSON.stringify({ title, bodyMarkdown: body, ...(folder !== '' ? { folder } : {}), ...(tags.length > 0 ? { tags } : {}), ...(String(isPinned) === 'true' ? { isPinned: true } : {}) }) });
    const id = r.ok ? String((r.body as { note?: { id?: string } }).note?.id ?? '') : '';
    return { ok: r.ok && id !== '', error: r.ok ? '' : r.error, id, title, body };
  },
  updateNote: async ([id, title, body, isPinned, tags, folder], store) =>
    reply(await callWith(store, `/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, bodyMarkdown: body, isPinned, tags, folder: folder === '' ? null : folder }),
    })),
  trashNote: async ([id], store) =>
    reply(await callWith(store, `/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ deletedAt: 1 }) })),
  restoreNote: async ([id], store) =>
    reply(await callWith(store, `/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ deletedAt: null }) })),
  deleteNote: async ([id], store) =>
    reply(await callWith(store, `/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })),
  loadNoteLinks: async ([noteId], store): Promise<Result<'loadNoteLinks'>> => {
    const owner = who(store);
    if (owner === '' || noteId === '') return { owner, links: [] };
    const r = await callWith(store, `/shareable-links/resource/note/${encodeURIComponent(noteId)}`);
    if (!r.ok) throw new Error(r.error);
    const links = (r.body as { links?: { id: string; slug: string }[] }).links ?? [];
    return { owner, links: links.map((l) => ({ id: l.id, slug: l.slug })) };
  },
  createShareLink: async ([noteId], store) => {
    const r = await callWith(store, '/shareable-links', { method: 'POST', body: JSON.stringify({ resourceType: 'note', resourceId: noteId }) });
    if (!r.ok) return { ok: false, url: '', error: r.error };
    return { ok: true, url: String((r.body as { url?: unknown }).url ?? ''), error: '' };
  },
  revokeLink: async ([linkId], store) =>
    reply(await callWith(store, `/shareable-links/${encodeURIComponent(linkId)}`, { method: 'DELETE' })),
  loadNoteShares: async ([noteId], store): Promise<Result<'loadNoteShares'>> => {
    const owner = who(store);
    if (owner === '' || noteId === '') return { owner, shares: [] };
    const r = await callWith(store, `/note-shares/note/${encodeURIComponent(noteId)}`);
    if (!r.ok) throw new Error(r.error);
    const shares = (r.body as { shares?: { id: string; sharedWithUserEmail?: string | null; permission?: string }[] }).shares ?? [];
    return { owner, shares: shares.map((s) => ({ id: s.id, email: s.sharedWithUserEmail ?? '', permission: s.permission ?? 'view' })) };
  },
  shareNote: async ([noteId, email, permission], store) =>
    reply(await callWith(store, '/note-shares', { method: 'POST', body: JSON.stringify({ noteId, sharedWithUserEmail: email, permission }) })),
  unshareNote: async ([shareId], store) =>
    reply(await callWith(store, `/note-shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' })),
  loadShared: async (_args, store): Promise<Result<'loadShared'>> => {
    const owner = who(store);
    if (owner === '') return { owner, notes: [] };
    const r = await callWith(store, '/note-shares/shared-with-me');
    if (!r.ok) throw new Error(r.error);
    const notes = (r.body as { notes?: Record<string, unknown>[] }).notes ?? [];
    return {
      owner,
      notes: notes.map((n) => ({
        id: String(n.id ?? ''),
        title: String(n.title ?? ''),
        body: markdownOf(n.bodyMarkdown, n.body),
        sharedBy: String(n.sharedByDisplayName || n.sharedByEmail || ''),
      })),
    };
  },
  loadPublicNote: async ([slug], store): Promise<Result<'loadPublicNote'>> => {
    if (slug === '') return { found: false, title: '', body: '' };
    const r = await callWith(store, `/public/notes/${encodeURIComponent(slug)}`);
    if (!r.ok) return { found: false, title: '', body: '' }; // gone or expired
    const b = r.body as { title?: unknown; content?: unknown; bodyMarkdown?: unknown };
    return { found: true, title: String(b.title ?? ''), body: markdownOf(b.bodyMarkdown, b.content) };
  },
  uploadNoteImage: ([noteId, name, path, mime], store, storage) => uploadNoteImageOne(noteId, name, path, mime, store, storage),
  // Several picked images, one upload after another; the urls come back one per line.
  uploadNoteImages: async ([noteId, names, paths, mimes], store, storage) => {
    const ns = names.split('\n');
    const ps = paths.split('\n');
    const ms = mimes.split('\n');
    const urls: string[] = [];
    let error = '';
    for (let i = 0; i < ps.length; i++) {
      const r = await uploadNoteImageOne(noteId, ns[i] ?? '', ps[i], ms[i] ?? '', store, storage);
      if (r.ok) urls.push(`${r.url}\t${(ns[i] ?? '').replace(/[\[\]()\t\r\n]/g, ' ').trim()}`);
      else error = r.error;
    }
    return { ok: urls.length > 0, url: urls.join('\n'), error: urls.length > 0 && error !== '' ? 'Some images could not be uploaded.' : error };
  },
  loadLists: async (_args, store): Promise<Result<'loadLists'>> => {
    const owner = who(store);
    if (owner === '') return { owner, lists: [] };
    const r = await callWith(store, '/task-lists');
    if (!r.ok) throw new Error(r.error);
    const body = r.body as { lists?: unknown };
    if (!Array.isArray(body.lists) || !body.lists.every(isListBody)) throw new Error('The server returned an invalid list.');
    return { owner, lists: body.lists.map((l) => ({ id: l.id, name: l.name, folderId: (l as { folderId?: string | null }).folderId ?? '', icon: l.icon ?? '', color: l.color ?? '', uncategorizedName: (l as { uncategorizedName?: string | null }).uncategorizedName ?? '', grocery: (l as { groceryMode?: boolean }).groceryMode === true, viewMode: (l as { viewMode?: string | null }).viewMode ?? '' })) };
  },
  // New list: the name, its folder ("" or "-" for none), icon and color.
  highlightCode: async ([body]): Promise<Result<'highlightCode'>> => ({ blocks: highlightBlocks(body) }),
  createList: async ([name, folderId, icon, color, grocery], store) => {
    const body: Record<string, unknown> = { name, groceryMode: String(grocery) === 'true' };
    if (folderId !== '' && folderId !== '-') body.folderId = folderId;
    if (icon !== '') body.icon = icon;
    if (color !== '') body.color = color;
    return reply(await callWith(store, '/task-lists', { method: 'POST', body: JSON.stringify(body) }));
  },
  // The name of a list's Uncategorized section ("" restores the default).
  renameUncategorized: async ([id, name], store) =>
    reply(await callWith(store, `/task-lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ uncategorizedName: name }) })),
  loadTasks: async ([listId], store): Promise<Result<'loadTasks'>> => {
    const owner = who(store);
    if (owner === '' || listId === '') return { owner, listId, tasks: [] };
    const r = await boardOf(store, listId);
    if (!r.ok) throw new Error(r.error);
    const body = r.body as { tasks?: unknown };
    if (!Array.isArray(body.tasks) || !body.tasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    // Not done first, in the server's order: the order the list relies on.
    const zone = deviceZone();
    const tasks = body.tasks
      .map((t) => taskRecord(t, zone))
      .sort((a, b) => (a.isDone === b.isDone ? 0 : a.isDone ? 1 : -1));
    return { owner, listId, tasks };
  },
  createTask: async ([listId, sectionId, title], store) => {
    const body: Record<string, unknown> = { listId, title };
    if (sectionId !== '') body.sectionId = sectionId;
    return reply(await callWith(store, '/tasks', { method: 'POST', body: JSON.stringify(body) }));
  },
  createTaskFull: async ([listId, sectionId, title, notes, url, dueDay, dueTime, reminder, recurrence, flagged, priority, tags], store) => {
    const due = dueBody(dueDay, dueTime, reminder, recurrence);
    if ('error' in due) return { ok: false, error: due.error };
    return reply(await callWith(store, '/tasks', {
      method: 'POST',
      body: JSON.stringify({ listId, sectionId: sectionId === '' ? null : sectionId, title, notes, url: url.trim() === '' ? null : url.trim(), ...due, flagged, priority: priority === 0 ? null : priority, tags }),
    }));
  },
  updateTask: async ([id, title, notes, url, dueDay, dueTime, reminder, recurrence, flagged, priority, tags, listId, sectionId], store) => {
    const due = dueBody(dueDay, dueTime, reminder, recurrence);
    if ('error' in due) return { ok: false, error: due.error };
    // A task's notes are a plain column: the app's Markdown is stored as written.
    return reply(await callWith(store, `/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, notes, url: url.trim() === '' ? null : url.trim(), ...due, flagged, priority: priority === 0 ? null : priority, tags, listId, sectionId: sectionId === '' ? null : sectionId }),
    }));
  },
  // Finishing a task in a list with a Done section moves it there (`doneSection` "" leaves it where it is); unchecking a task
  // that sits in Done (`doneSection` "-") puts it back in Uncategorized.
  setTaskDoneIn: async ([id, done, doneSection], store) => {
    const body: Record<string, unknown> = { isDone: String(done) === 'true' };
    if (doneSection === '-') body.sectionId = null;
    else if (doneSection !== '') body.sectionId = doneSection;
    return reply(await callWith(store, `/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }));
  },
  setTaskDone: async ([id, done], store) =>
    reply(await callWith(store, `/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ isDone: done }) })),
  deleteTask: async ([id], store) =>
    reply(await callWith(store, `/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ deletedAt: 1 }) })),
  reorderTasks: async ([listId, dragged, before], store): Promise<Result<'reorderTasks'>> => {
    const owner = who(store);
    if (owner === '' || listId === '') return { owner, listId, order: [] };
    const r = await callWith(store, `/tasks?listId=${encodeURIComponent(listId)}`);
    if (!r.ok) throw new Error(r.error);
    const body = r.body as { tasks?: unknown };
    if (!Array.isArray(body.tasks) || !body.tasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    const draggedRow = body.tasks.find((t) => t.id === dragged);
    if (!draggedRow) return { owner, listId, order: body.tasks.map((t) => t.id) };
    const group = body.tasks
      .filter((t) => t.isDone === draggedRow.isDone && (t.sectionId ?? '') === (draggedRow.sectionId ?? ''))
      .sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)))
      .map((t) => t.id);
    const from = group.indexOf(dragged);
    if (from >= 0) group.splice(from, 1);
    const at = before === '' || !group.includes(before) ? group.length : group.indexOf(before);
    group.splice(at < 0 ? group.length : at, 0, dragged);
    let moved = 0;
    for (let i = 0; i < group.length; i++) {
      const row = body.tasks.find((t) => t.id === group[i]);
      const wanted = i * 100;
      if (row && (row.sortOrder ?? 0) !== wanted) {
        await callWith(store, `/tasks/${encodeURIComponent(group[i])}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: wanted }) });
        moved++;
      }
    }
    return { owner, listId, order: group };
  },
  loadSubtasks: async ([parentId], store): Promise<Result<'loadSubtasks'>> => {
    const owner = who(store);
    if (owner === '' || parentId === '') return { owner, parentId, tasks: [] };
    const r = await callWith(store, `/tasks?parentId=${encodeURIComponent(parentId)}`);
    if (!r.ok) throw new Error(r.error);
    const body = r.body as { tasks?: unknown };
    if (!Array.isArray(body.tasks) || !body.tasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    const zone = deviceZone();
    return { owner, parentId, tasks: body.tasks.map((t) => taskRecord(t, zone)) };
  },
  // The board shows every card's subtasks at once: the list call returns only top-level tasks,
  // so each parent with subtasks is fetched in parallel; each Task carries its `parentId`.
  // The people on a list (its owner and who it is shared with), for the assignee picker and the row avatars.
  loadMembers: async ([listId], store): Promise<Result<'loadMembers'>> => {
    const owner = who(store);
    if (owner === '' || listId === '') return { owner, listId, members: [] };
    const r = await boardOf(store, listId);
    if (!r.ok) return { owner, listId, members: [] };
    const rows = (r.body as { members?: Record<string, unknown>[] }).members ?? [];
    return { owner, listId, members: rows.map((m) => ({ id: String(m.id ?? ''), role: String(m.role ?? ''), name: String(m.displayName || m.email || ''), email: String(m.email ?? ''), icon: String(m.avatarIcon ?? ''), color: String(m.avatarColor ?? '') })) };
  },
  assignTask: async ([id, assigneeId], store) =>
    reply(await callWith(store, `/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ assigneeId: assigneeId === '' ? null : assigneeId }) })),
  loadNotifications: async (_args, store): Promise<Result<'loadNotifications'>> => {
    const owner = who(store);
    if (owner === '') return { owner, items: [] };
    const r = await callWith(store, '/notifications');
    if (!r.ok) return { owner, items: [] };
    const rows = (r.body as { notifications?: Record<string, unknown>[] }).notifications ?? [];
    return {
      owner,
      items: rows.map((n) => ({
        id: String(n.id ?? ''),
        type: String(n.type ?? ''),
        title: String(n.title ?? ''),
        message: String(n.message ?? ''),
        isRead: n.isRead === true,
        createdAt: typeof n.createdAt === 'number' ? n.createdAt : 0,
        resourceId: String(n.resourceId ?? ''),
        resourceType: String(n.resourceType ?? ''),
        listId: String(n.listId ?? ''),
      })),
    };
  },
  markNotificationsRead: async (_args, store) =>
    reply(await callWith(store, '/notifications/read-all', { method: 'PATCH' })),
  loadBoardSubtasks: async ([listId], store): Promise<Result<'loadBoardSubtasks'>> => {
    const owner = who(store);
    if (owner === '' || listId === '') return { owner, listId, tasks: [] };
    const r = await boardOf(store, listId);
    if (!r.ok) throw new Error(r.error);
    const body = r.body as { subtasks?: unknown };
    const rows = body.subtasks ?? [];
    if (!Array.isArray(rows) || !rows.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    const zone = deviceZone();
    return { owner, listId, tasks: rows.map((t) => taskRecord(t, zone)) };
  },
  createSubtask: async ([listId, parentId, title], store) =>
    reply(await callWith(store, '/tasks', { method: 'POST', body: JSON.stringify({ listId, parentId, title }) })),
  loadSections: async ([listId], store): Promise<Result<'loadSections'>> => {
    const owner = who(store);
    if (owner === '' || listId === '') return { owner, listId, sections: [] };
    const r = await boardOf(store, listId);
    if (!r.ok) throw new Error(r.error);
    const rawSections = [...((r.body as { sections?: { id: string; name: string; icon?: string | null; color?: string | null; sortOrder?: number | null }[] }).sections ?? [])];
    const rawTasks = (r.body as { tasks?: unknown }).tasks ?? [];
    if (!Array.isArray(rawTasks) || !rawTasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    // Each section carries its own tasks, so the view never filters per row.
    type TaskRow = Result<'loadTasks'>['tasks'][number];
    const bySection = new Map<string, TaskRow[]>();
    const zone = deviceZone();
    for (const raw of rawTasks) {
      const bucket = bySection.get(raw.sectionId ?? '') ?? [];
      bucket.push(taskRecord(raw, zone));
      bySection.set(raw.sectionId ?? '', bucket);
    }
    const ordered = (rows: TaskRow[]): TaskRow[] => rows.sort((a, b) => (a.isDone === b.isDone ? 0 : a.isDone ? 1 : -1));
    const sections = rawSections
      .sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)))
      .map((s) => ({ id: s.id, name: s.name, icon: s.icon ?? '', color: s.color ?? '', tasks: ordered(bySection.get(s.id) ?? []) }));
    return { owner, listId, sections };
  },
  // A new section goes after the list's others: the server lists equal sortOrders newest first, so it is given the next position.
  createSection: async ([listId, name, icon, color], store) => {
    const existing = await callWith(store, `/task-sections?listId=${encodeURIComponent(listId)}`);
    const rows = existing.ok ? ((existing.body as { sections?: { sortOrder?: number | null }[] }).sections ?? []) : [];
    const sortOrder = Math.max(0, ...rows.map((x) => x.sortOrder ?? 0)) + STEP;
    return reply(await callWith(store, '/task-sections', { method: 'POST', body: JSON.stringify({ listId, name, sortOrder, ...(icon !== '' ? { icon } : {}), ...(color !== '' ? { color } : {}) }) }));
  },
  // Section rename: PATCH /task-sections/:id { name } (the server accepts name on update).
  renameSection: async ([, sectionId, name], store) =>
    reply(await callWith(store, `/task-sections/${encodeURIComponent(sectionId)}`, { method: 'PATCH', body: JSON.stringify({ name }) })),
  // Section style: PATCH /task-sections/:id { icon, color }; "" clears either.
  updateSection: async ([, sectionId, icon, color], store) =>
    reply(await callWith(store, `/task-sections/${encodeURIComponent(sectionId)}`, { method: 'PATCH', body: JSON.stringify({ icon, color }) })),
  // Lucide icons: GET /lucide/:name (paths, 24x24 stroke icons). Answers are cached per name; a
  // failure (unknown name, offline) is an icon with no paths, and is not cached.
  lucideIcon: async ([name], store): Promise<Result<'lucideIcon'>> => {
    const known = lucideCache.get(name);
    if (known) return known;
    const r = await callWith(store, `/lucide/${encodeURIComponent(name)}`);
    if (!r.ok) return { name, paths: [] };
    const paths = (r.body as { paths?: unknown }).paths;
    const icon = { name, paths: Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [] };
    lucideCache.set(name, icon);
    return icon;
  },
  // Icon search: GET /lucide-search?q= (names). An empty query asks nothing.
  lucideSearch: async ([q], store): Promise<Result<'lucideSearch'>> => {
    if (q.trim() === '') return { names: [] };
    const r = await callWith(store, `/lucide-search?q=${encodeURIComponent(q.trim())}`);
    if (!r.ok) return { names: [] };
    const names = (r.body as { names?: unknown }).names;
    return { names: Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [] };
  },
  loadTaskFolders: async (_args, store): Promise<Result<'loadTaskFolders'>> => {
    const owner = who(store);
    if (owner === '') return { owner, folders: [] };
    const r = await callWith(store, '/tasklist-folders');
    if (!r.ok) throw new Error(r.error);
    const folders = (r.body as { folders?: { id: string; name: string }[] }).folders ?? [];
    return { owner, folders: folders.map((f) => ({ id: f.id, name: f.name })) };
  },
  createFolder: async ([name], store) =>
    reply(await callWith(store, '/tasklist-folders', { method: 'POST', body: JSON.stringify({ name }) })),
  updateList: async ([id, name, folderId, icon, color, grocery], store) => {
    const body: Record<string, unknown> = { name, icon, color, groceryMode: String(grocery) === 'true' };
    if (folderId === '-') body.folderId = null;
    else if (folderId !== '') body.folderId = folderId;
    return reply(await callWith(store, `/task-lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }));
  },
  deleteList: async ([id], store) =>
    reply(await callWith(store, `/task-lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ deletedAt: 1 }) })),
  loadListShares: async ([listId], store): Promise<Result<'loadListShares'>> => {
    const owner = who(store);
    if (owner === '' || listId === '') return { owner, shares: [] };
    const r = await callWith(store, `/task-list-shares/list/${encodeURIComponent(listId)}`);
    if (!r.ok) throw new Error(r.error);
    const shares = (r.body as { shares?: { id: string; sharedWithUserEmail?: string | null; permission?: string }[] }).shares ?? [];
    return { owner, shares: shares.map((s) => ({ id: s.id, email: s.sharedWithUserEmail ?? '', permission: s.permission ?? 'view' })) };
  },
  shareListWith: async ([listId, email, permission], store) =>
    reply(await callWith(store, '/task-list-shares', { method: 'POST', body: JSON.stringify({ listId, sharedWithUserEmail: email, permission }) })),
  unshareList: async ([shareId], store) =>
    reply(await callWith(store, `/task-list-shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' })),
  loadSharedLists: async (_args, store): Promise<Result<'loadSharedLists'>> => {
    const owner = who(store);
    if (owner === '') return { owner, lists: [] };
    const r = await callWith(store, '/task-list-shares/shared-with-me');
    if (!r.ok) throw new Error(r.error);
    const lists = (r.body as { lists?: Record<string, unknown>[] }).lists ?? [];
    return { owner, lists: lists.map((l) => ({ id: String(l.id ?? ''), name: String(l.name ?? ''), sharedBy: String(l.sharedByDisplayName || l.sharedByEmail || ''), permission: String(l.permission ?? 'view'), icon: String(l.icon ?? ''), color: String(l.color ?? ''), uncategorizedName: String(l.uncategorized_name ?? ''), grocery: l.grocery_mode === 1, viewMode: String(l.view_mode ?? '') })) };
  },
  loadAttachments: async ([taskId], store): Promise<Result<'loadAttachments'>> => {
    const owner = who(store);
    if (owner === '' || taskId === '') return { owner, taskId, items: [] };
    const r = await callWith(store, `/task-attachments/task/${encodeURIComponent(taskId)}`);
    if (!r.ok) throw new Error(r.error);
    const items = (r.body as { attachments?: { id: string; url?: string | null }[] }).attachments ?? [];
    return { owner, taskId, items: items.filter((a) => a.url).map((a) => ({ id: a.id, url: String(a.url) })) };
  },
  uploadTaskImage: async ([taskId, name, path, mime], store, storage) => {
    try {
      let bytes: ArrayBuffer;
      try {
        bytes = await storage.fs.readFile(path);
      } catch {
        return { ok: false, url: '', error: 'Could not read the image. Try again.' };
      }
      const known = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
      let type = known.includes(mime) ? mime : '';
      if (type === '') {
        const ext = name.split('.').at(-1) ?? '';
        type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      }
      const mp = multipart([], { field: 'image', name, type, bytes });
      const res = await fetch(`${originOf(store)}/task-attachments/task/${encodeURIComponent(taskId)}/images`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer(store)}`, 'content-type': mp.contentType },
        body: mp.body,
        exactTimeout: 30000,
      });
      if (!res.ok) return { ok: false, url: '', error: 'The image could not be uploaded. Try again.' };
      return { ok: true, url: '', error: '' };
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return { ok: false, url: '', error: OFFLINE };
    }
  },
  // The profile (GET /profile). The photo's file name never changes on the server, so its url
  // carries the update time: a new photo is a new address for the image cache.
  loadProfile: async (_args, store): Promise<Result<'loadProfile'>> => {
    const owner = who(store);
    if (owner === '') return { owner, displayName: '', avatarUrl: '', avatarIcon: '', avatarColor: '' };
    const r = await callWith(store, '/profile');
    if (!r.ok) throw new Error(r.error);
    const b = r.body as { displayName?: string | null; avatarIcon?: string | null; avatarColor?: string | null; avatar?: { url?: string; updatedAt?: number } | null };
    const url = b.avatar?.url ?? '';
    return {
      owner,
      displayName: b.displayName ?? '',
      avatarUrl: url === '' ? '' : `${url}?v=${b.avatar?.updatedAt ?? 0}`,
      avatarIcon: b.avatarIcon ?? '',
      avatarColor: b.avatarColor ?? '',
    };
  },
  updateName: async ([name], store): Promise<Result<'updateName'>> => {
    const r = await callWith(store, '/profile', { method: 'PUT', body: JSON.stringify({ displayName: name }) });
    if (!r.ok) return reply(r);
    // Sign-in keeps the shown name in the store; the same name shows from here on.
    (store as Store).set('name', name);
    return { ok: true, error: '' };
  },
  // An empty icon or color clears it (the server's "" clears; the initials show again).
  updateStyle: async ([icon, color], store): Promise<Result<'updateStyle'>> =>
    reply(await callWith(store, '/profile', { method: 'PUT', body: JSON.stringify({ avatarIcon: icon, avatarColor: color }) })),
  uploadAvatar: async ([name, path, mime], store, storage): Promise<Result<'uploadAvatar'>> => {
    try {
      let bytes: ArrayBuffer;
      try {
        bytes = await storage.fs.readFile(path);
      } catch {
        return { ok: false, error: 'Could not read the photo. Try again.' };
      }
      if (bytes.byteLength > 2 * 1024 * 1024) return { ok: false, error: 'The photo is larger than 2 MB.' };
      const known = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
      let type = known.includes(mime) ? mime : '';
      if (type === '') {
        const ext = name.split('.').at(-1) ?? '';
        type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      }
      const mp = multipart([], { field: 'avatar', name, type, bytes });
      const res = await fetch(`${originOf(store)}/profile/avatar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer(store)}`, 'content-type': mp.contentType },
        body: mp.body,
        exactTimeout: 30000,
      });
      if (!res.ok) return { ok: false, error: 'The photo could not be uploaded. Try again.' };
      return { ok: true, error: '' };
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return { ok: false, error: OFFLINE };
    }
  },
  removeAvatar: async (_args, store): Promise<Result<'removeAvatar'>> =>
    reply(await callWith(store, '/profile/avatar', { method: 'DELETE' })),
  // The server answers a wrong current password with invalid_credentials (shown as the sign-in text by `call`).
  changePassword: async ([current, next], store): Promise<Result<'changePassword'>> => {
    const r = await callWith(store, '/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    if (r.ok) return { ok: true, error: '' };
    if (r.error === friendly('invalid_credentials')) return { ok: false, error: 'Wrong current password.' };
    if (r.error === friendly('invalid_body')) return { ok: false, error: 'Use at least 8 characters.' };
    return { ok: false, error: r.error };
  },
  // The appearance the person chose: "auto" follows the system, "light" or "dark" pins it.
  loadPrefs: (_args, store): Result<'loadPrefs'> => ({ appearance: String((store as Store).get('appearance') ?? 'auto'), boards: String((store as Store).get('boards') ?? '') }),
  saveAppearance: ([value], store): Result<'saveAppearance'> => {
    (store as Store).set('appearance', value);
    return { ok: true, error: '' };
  },
  // A list's view ("list" or "board") is kept on the server, so every device shows it the same.
  setListView: async ([id, mode], store) =>
    reply(await callWith(store, `/task-lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ viewMode: mode === 'board' ? 'board' : 'list' }) })),
  // The calendar's cells for the viewed period: a month grid (padded to whole
  // weeks), a week of seven days, or a single day — each cell with its events.
  loadCalendarView: async ([today, anchor, mode, offset], store): Promise<Result<'loadCalendarView'>> => {
    const owner = who(store);
    if (owner === '' || today === '' || anchor === '') return { owner, periodLabel: '', cells: [] };
    const day = 60 * 60 * 24 * 1000;
    const [y, m, d] = anchor.split('-').map(Number);
    const midnight = Date.parse(`${anchor}T00:00:00`);
    let start: number;
    let end: number;
    let label: string;
    let inMonthOf: { y: number; m: number } | null = null;
    if (mode === 'day') {
      start = midnight + offset * day;
      end = start + day;
      label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(start));
    } else if (mode === 'week') {
      const weekday = new Date(midnight).getDay(); // 0 = Sunday
      start = midnight - weekday * day + offset * 7 * day;
      end = start + 7 * day;
      const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      label = `${fmt.format(new Date(start))} – ${fmt.format(new Date(end - day))}, ${new Date(end - day).getFullYear()}`;
    } else {
      const first = new Date(y, m - 1 + offset, 1);
      inMonthOf = { y: first.getFullYear(), m: first.getMonth() + 1 };
      start = first.getTime() - new Date(first).getDay() * day;
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0); // the month's last day
      end = last.getTime() + (6 - new Date(last).getDay()) * day + day;
      label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(first);
    }
    const e = await callWith(store, `/calendars/user/events?startTime=${start}&endTime=${end}`);
    if (!e.ok) throw new Error(e.error);
    const events = (e.body as { events?: unknown }).events ?? [];
    if (!Array.isArray(events) || !events.every(isEventBody)) throw new Error('The server returned an invalid events list.');
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byDay = new Map<string, DayRow[]>();
    for (const ev of events) {
      if (ev.endTime <= start || ev.startTime >= end) continue;
      const key = dayKey(ev.startTime, zone);
      const rows = byDay.get(key) ?? [];
      rows.push(eventRowOf(ev, zone));
      byDay.set(key, rows);
    }
    // All-day events first, then by start: the agenda and the week list read in this order.
    for (const rows of byDay.values()) {
      rows.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startTime - b.startTime);
      layoutDay(rows);
    }
    type Cell = Result<'loadCalendarView'>['cells'][number];
    const cells: Cell[] = [];
    const cursor = new Date(start);
    const cellCount = Math.round((end - start) / day);
    const weekdayDate = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    for (let i = 0; i < cellCount; i++) {
      // Local date arithmetic: adding 24h-ms walks into DST and repeats a day.
      const t = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i);
      const key = dayKey(t.getTime(), zone);
      const rows = byDay.get(key) ?? [];
      const inPeriod = inMonthOf == null ? true : t.getMonth() + 1 === inMonthOf.m && t.getFullYear() === inMonthOf.y;
      const short = mode === 'week' ? `${weekdayDate.format(t)} ${t.getDate()}` : String(t.getDate());
      cells.push({ day: key, label: mode === 'day' ? label : short, heading: longDate.format(t), inPeriod, isToday: key === today, events: rows });
    }
    return { owner, periodLabel: label, cells };
  },
  // Live changes (documentation/backend/collaboration.md): an authorized request gets a single-use ticket, then
  // `liveEvents` (asked for that attempt) opens the WebSocket with it. Each message bumps `ticks`.
  liveTicket: async ([attempt], store) => {
    liveAttempt = attempt;
    liveTickets.clear();
    const r = await callWith(store, '/live/ticket', { method: 'POST' });
    if (!r.ok) throw new Error(r.error);
    const ticket = (r.body as { ticket?: unknown }).ticket;
    if (typeof ticket !== 'string' || ticket === '') throw new Error('The server returned no live ticket.');
    if (attempt === liveAttempt) liveTickets.set(attempt, ticket);
    return attempt;
  },
  liveEvents: ([attempt], store) => {
    const ticket = liveTickets.get(attempt);
    liveTickets.delete(attempt);
    if (!ticket) throw new Error('connect again to request a fresh ticket');
    // Opened with no await before the fetch: the stream must start in this turn.
    liveOpen = false;
    forgetAnswers();
    return fetch(`${kept(store) ? kept(store).replace(/^http/, 'ws') : SOCKET}/live?ticket=${encodeURIComponent(ticket)}`, {
      exactIdleTimeout: 120000,
      exactStream(event: StreamEvent) {
        // A message says something changed, so what was kept is old; a socket that is not open says nothing, so nothing is kept.
        if (event.type === 'message' || event.type === 'open') liveOpen = true;
        else liveOpen = false;
        forgetAnswers();
        if (event.type === 'message') liveTicks += 1;
        return { status: event.type === 'message' ? 'open' : event.type, ticks: liveTicks, text: event.type === 'message' ? String(event.data) : '' };
      },
    });
  },
  // The sidebar's open tasks, the five newest of each list (GET /tasks without listId returns all top-level tasks).
  loadRecentTasks: async (_args, store): Promise<Result<'loadRecentTasks'>> => {
    const owner = who(store);
    if (owner === '') return { owner, tasks: [] };
    const r = await callWith(store, '/tasks');
    if (!r.ok) throw new Error(r.error);
    const body = r.body as { tasks?: unknown };
    if (!Array.isArray(body.tasks) || !body.tasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    const tasks = body.tasks
      .filter((t) => !t.isDone)
      .map((t) => ({ id: t.id, title: t.title, listId: (t as { listId?: string | null }).listId ?? '', updatedAt: (t as { updatedAt?: number }).updatedAt ?? 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const perList = new Map<string, number>();
    const recent = tasks.filter((t) => {
      const n = perList.get(t.listId) ?? 0;
      perList.set(t.listId, n + 1);
      return n < 5;
    });
    return { owner, tasks: recent.map((t) => ({ id: t.id, title: t.title, listId: t.listId })) };
  },
  // The sidebar's ten events: upcoming from the start of today (soonest first), then the latest past ones from the last 90 days. Hidden calendars are left out.
  loadRecentEvents: async ([today, hidden], store): Promise<Result<'loadRecentEvents'>> => {
    const owner = who(store);
    if (owner === '' || today === '') return { owner, events: [] };
    const day = 60 * 60 * 24 * 1000;
    const start = Date.parse(`${today}T00:00:00`);
    const e = await callWith(store, `/calendars/user/events?startTime=${start - 90 * day}&endTime=${start + 366 * day}`);
    if (!e.ok) throw new Error(e.error);
    const events = (e.body as { events?: unknown }).events ?? [];
    if (!Array.isArray(events) || !events.every(isEventBody)) throw new Error('The server returned an invalid events list.');
    const zone = deviceZone();
    const visible = events.filter((ev) => !hidden.includes(ev.calendarId ?? ''));
    const upcoming = visible.filter((ev) => ev.startTime >= start).sort((a, b) => a.startTime - b.startTime);
    const past = visible.filter((ev) => ev.startTime < start).sort((a, b) => b.startTime - a.startTime);
    return { owner, events: upcoming.concat(past).slice(0, 10).map((ev) => eventRowOf(ev, zone)) };
  },
  loadCalendars: async (_args, store): Promise<Result<'loadCalendars'>> => {
    const owner = who(store);
    if (owner === '') return { owner, calendars: [] };
    // ensure-defaults creates the default calendars once (not safe to run concurrently) and returns the list.
    const r = await callWith(store, '/calendars/ensure-defaults', { method: 'POST' });
    if (!r.ok) throw new Error(r.error);
    const list = (r.body as { calendars?: { id: string; name: string; color: string | null; type: string; isActive?: boolean; syncKind?: string | null; syncError?: string | null }[] }).calendars ?? [];
    return { owner, calendars: list.map((c) => ({ id: c.id, name: c.name, color: c.color ?? '', isActive: c.isActive !== false, type: c.type, syncKind: c.syncKind ?? '', syncError: c.syncError ?? '' })) };
  },
  // Subscriptions are read-only copies of a server's calendar: an ICS link (iCloud public calendar, Google's secret iCal address, Outlook) or a CalDAV account.
  subscribeCalendar: async ([url, name, username, password], store) =>
    reply(await callWith(store, '/calendars/subscribe', { method: 'POST', exactTimeout: 60000, body: JSON.stringify({ url, name: name === '' ? undefined : name, username: username === '' ? undefined : username, password: password === '' ? undefined : password }) } as RequestInit)),
  discoverCaldav: async ([url, username, password], store): Promise<Result<'discoverCaldav'>> => {
    const r = await callWith(store, '/calendars/caldav/discover', { method: 'POST', exactTimeout: 60000, body: JSON.stringify({ url, username, password }) } as RequestInit);
    if (!r.ok) return { ok: false, error: r.error, found: [] };
    const list = (r.body as { calendars?: { url: string; name: string; color?: string }[] }).calendars ?? [];
    return { ok: true, error: '', found: list.map((c) => ({ url: c.url, name: c.name, color: c.color ?? '' })) };
  },
  // `picked` is the chosen calendars' urls, one per line (the account's calendars are looked up again, so names and colors are the server's).
  connectCaldav: async ([url, username, password, picked], store) => {
    const want = new Set(picked.split('\n').filter((u) => u !== ''));
    const found = await callWith(store, '/calendars/caldav/discover', { method: 'POST', exactTimeout: 60000, body: JSON.stringify({ url, username, password }) } as RequestInit);
    if (!found.ok) return reply(found);
    const list = ((found.body as { calendars?: { url: string; name: string; color?: string }[] }).calendars ?? []).filter((c) => want.has(c.url));
    if (list.length === 0) return { ok: false, error: 'Choose at least one calendar.' };
    return reply(await callWith(store, '/calendars/caldav/connect', { method: 'POST', exactTimeout: 120000, body: JSON.stringify({ url, username, password, calendars: list }) } as RequestInit));
  },
  syncCalendar: async ([id], store) =>
    reply(await callWith(store, `/calendars/${encodeURIComponent(id)}/sync`, { method: 'POST', exactTimeout: 60000 } as RequestInit)),
  createCalendar: async ([name], store) =>
    reply(await callWith(store, '/calendars', { method: 'POST', body: JSON.stringify({ name, color: '#007AFF', type: 'internal' }) })),
  // A full PATCH: the caller sends the calendar's name, color and visibility (hiding is isActive: false).
  updateCalendar: async ([id, name, color, isActive], store) =>
    reply(await callWith(store, `/calendars/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name, color, isActive }) })),
  deleteCalendar: async ([id], store) =>
    reply(await callWith(store, `/calendars/${encodeURIComponent(id)}`, { method: 'DELETE' })),
  createEvent: async ([calendarId, title, notes, url, location, allDay, startDay, startTime, endDay, endTime, repeat, alert, attendees], store) => {
    const span = eventSpan(allDay, startDay, startTime, endDay, endTime);
    if ('error' in span) return { ok: false, error: span.error };
    return reply(await callWith(store, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(eventFields(title, notes, url, location, allDay, span, repeat, alert, attendees)),
    }));
  },
  updateEvent: async ([eventId, title, notes, url, location, allDay, startDay, startTime, endDay, endTime, repeat, alert, attendees], store) => {
    const span = eventSpan(allDay, startDay, startTime, endDay, endTime);
    if ('error' in span) return { ok: false, error: span.error };
    return reply(await callWith(store, `/calendars/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify(eventFields(title, notes, url, location, allDay, span, repeat, alert, attendees)),
    }));
  },
  deleteEvent: async ([eventId], store) =>
    reply(await callWith(store, `/calendars/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })),
  // Drag & drop: a fresh read, then one PATCH for the moved row (its new sortOrder and section).
  // `doneFlag`: "done" when the target is the list's Done section (the task becomes done), "open" when it is another section while a
  // Done section exists (a task dragged out of Done reopens), "" when the list has no Done section.
  placeTask: async ([listId, taskId, sectionId, before, doneFlag], store) => {
    const r = await callWith(store, `/tasks?listId=${encodeURIComponent(listId)}`);
    if (!r.ok) return { ok: false, error: r.error };
    const body = r.body as { tasks?: unknown };
    if (!Array.isArray(body.tasks) || !body.tasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    const column = body.tasks.filter((t) => (doneFlag === 'done' ? t.isDone : !t.isDone) && (t.sectionId ?? '') === sectionId);
    const extra: Record<string, unknown> = { sectionId: sectionId === '' ? null : sectionId };
    if (doneFlag === 'done') extra.isDone = true;
    else if (doneFlag === 'open') extra.isDone = false;
    return placeRow(store, '/tasks', column, taskId, before, extra);
  },
  // Smart sort: `spec` is "Department|id id;Department|id id" in walking order. Each department becomes a section
  // (an existing one of that name is reused) and its open tasks move there, in that order.
  sortTasks: async ([listId, spec], store) => {
    const r = await callWith(store, `/tasks?listId=${encodeURIComponent(listId)}`);
    if (!r.ok) return { ok: false, error: r.error };
    const body = r.body as { tasks?: unknown };
    if (!Array.isArray(body.tasks) || !body.tasks.every(isTaskBody)) throw new Error('The server returned an invalid task list.');
    const open = new Set(body.tasks.filter((t) => !t.isDone).map((t) => t.id));
    const sr = await callWith(store, `/task-sections?listId=${encodeURIComponent(listId)}`);
    if (!sr.ok) return { ok: false, error: sr.error };
    const existing = (sr.body as { sections?: { id: string; name: string; sortOrder?: number | null }[] }).sections ?? [];
    const sections = new Map(existing.map((x) => [x.name.trim().toLowerCase(), x.id]));
    const groups = spec.split(';').map((g) => g.split('|')[0].trim().toLowerCase());
    // The departments follow the sections already there, in walking order (a new section would otherwise come first).
    const base = Math.max(0, ...existing.filter((x) => !groups.includes(x.name.trim().toLowerCase())).map((x) => x.sortOrder ?? 0));
    let slot = 0;
    for (const group of spec.split(';')) {
      const [name, list = ''] = group.split('|');
      const ids = list.split(' ').filter((id) => open.has(id));
      if (name.trim() === '' || ids.length === 0) continue;
      let sectionId = sections.get(name.trim().toLowerCase());
      if (sectionId === undefined) {
        const c = await callWith(store, '/task-sections', { method: 'POST', body: JSON.stringify({ listId, name: name.trim() }) });
        if (!c.ok) return { ok: false, error: c.error };
        sectionId = (c.body as { section?: { id: string } }).section?.id;
        if (sectionId === undefined) return { ok: false, error: 'The section could not be made.' };
        sections.set(name.trim().toLowerCase(), sectionId);
      }
      slot += 1;
      const o = await callWith(store, `/task-sections/${encodeURIComponent(sectionId)}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: base + slot * STEP }) });
      if (!o.ok) return { ok: false, error: o.error };
      for (const [position, id] of ids.entries()) {
        const p = await callWith(store, `/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ sectionId, sortOrder: position * STEP }) });
        if (!p.ok) return { ok: false, error: p.error };
      }
    }
    return { ok: true, error: '' };
  },
  placeSection: async ([listId, id, before], store) => {
    const r = await callWith(store, `/task-sections?listId=${encodeURIComponent(listId)}`);
    if (!r.ok) return { ok: false, error: r.error };
    const raw = (r.body as { sections?: { id: string; sortOrder?: number | null }[] }).sections ?? [];
    return placeRow(store, '/task-sections', raw, id, before, {});
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  (source as string) === 'exactTime'
    ? (exactTimeSource() as never)
    : sources[source as keyof typeof sources](args as never, store, storage, native) as never;

// A dropped task shows where it landed at once: the server is asked for a fresh list, then for one PATCH, then the board is read
// again, and over a slow link the card would otherwise snap back until all of that ends. The overlay applies the same move to the
// task list the screen already has (new section, done state, and the slot before the card it was dropped on).
export const overlay: Overlay = (source, args, answer, writes) => {
  if (source !== 'loadTasks') return undefined;
  const shown = [...(answer as Result<'loadTasks'>).tasks];
  for (const w of writes) {
    if (w.source !== 'placeTask') continue;
    const [listId, taskId, sectionId, before, doneFlag] = w.args as [string, string, string, string, string];
    if (listId !== (args as [string])[0]) continue;
    const from = shown.findIndex((t) => t.id === taskId);
    if (from < 0) continue;
    const moved = { ...shown[from], sectionId };
    if (doneFlag === 'done') moved.isDone = true;
    else if (doneFlag === 'open') moved.isDone = false;
    shown.splice(from, 1);
    const at = before === '' ? -1 : shown.findIndex((t) => t.id === before);
    if (at >= 0) shown.splice(at, 0, moved);
    else {
      // Last in its column: after the column's final card, else with the open/done block it belongs to.
      let end = -1;
      shown.forEach((t, i) => { if (t.isDone === moved.isDone && t.sectionId === sectionId) end = i; });
      if (end >= 0) shown.splice(end + 1, 0, moved);
      else if (moved.isDone) shown.push(moved);
      else shown.splice(shown.findIndex((t) => t.isDone) < 0 ? shown.length : shown.findIndex((t) => t.isDone), 0, moved);
    }
  }
  return { ...(answer as Result<'loadTasks'>), tasks: shown } as never;
};
