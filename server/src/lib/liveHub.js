/**
 * Component: Live change channel (WebSocket)
 * Documentation: documentation/backend/collaboration.md
 *
 * A signed-in client asks `POST /live/ticket` (single use, 60 s), then opens `ws(s)://host/live?ticket=…`.
 * After a successful write to a task, section, list or share, everyone who can see that list (its owner and the people
 * it is shared with) gets `{"type":"changed","listId":…,"by":<userId>}` and refreshes what it shows.
 */
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const TTL_MS = 60_000;
const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const WATCHED = /^\/(tasks|task-sections|task-lists|task-list-shares|task-attachments|notes|note-shares|calendars)(\/|$)/;

export function createLiveHub({ repos, logger }) {
  const tickets = new Map();
  const sockets = new Map();
  const wss = new WebSocketServer({ noServer: true });

  function issue(userId) {
    const now = Date.now();
    for (const [key, t] of tickets) if (t.expires <= now) tickets.delete(key);
    const ticket = randomUUID();
    tickets.set(ticket, { userId, expires: now + TTL_MS });
    return ticket;
  }

  function redeem(ticket) {
    const t = tickets.get(ticket);
    tickets.delete(ticket); // consumed before the upgrade: a ticket opens one socket
    return t && t.expires > Date.now() ? t.userId : null;
  }

  function attach(httpServer) {
    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/live") return; // not ours (another upgrade handler, or none)
      const userId = redeem(url.searchParams.get("ticket") ?? "");
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const set = sockets.get(userId) ?? new Set();
        set.add(ws);
        sockets.set(userId, set);
        ws.on("close", () => {
          set.delete(ws);
          if (set.size === 0) sockets.delete(userId);
        });
        ws.on("error", () => ws.terminate());
        ws.send(JSON.stringify({ type: "hello" }));
      });
    });
  }

  function send(userIds, message) {
    const text = JSON.stringify(message);
    for (const id of new Set(userIds)) {
      for (const ws of sockets.get(id) ?? []) {
        if (ws.readyState === ws.OPEN) ws.send(text);
      }
    }
  }

  function recipientsOf(listId, actorId) {
    const ids = [actorId];
    const list = listId ? repos.taskLists.findByIdOnly(listId) : null;
    if (list) {
      ids.push(list.userId);
      for (const share of repos.taskListShares.findByListId(listId) ?? []) ids.push(share.sharedWithUserId);
    }
    return ids;
  }

  // The request's full path (req.path is relative to the router that handled it by the time the response finishes).
  const pathOf = (req) => req.originalUrl.split("?")[0];

  function listOf(req) {
    const [, kind, id] = pathOf(req).split("/");
    if (kind === "task-lists") return id || req.body?.listId || null;
    if (kind === "tasks") return id ? repos.tasks.findAnyById(id)?.listId : req.body?.listId;
    if (kind === "task-sections") return id ? repos.taskSections.findAnyById(id)?.listId : req.body?.listId;
    return req.body?.listId ?? null;
  }

  /** Notes: the writer's own devices and everyone the note is shared with. */
  function noteRecipients(req) {
    const ids = [req.auth.userId];
    const [, kind, id] = pathOf(req).split("/");
    const noteId = kind === "notes" ? id : req.body?.noteId;
    for (const share of noteId ? repos.noteShares.findByNoteId(noteId) ?? [] : []) ids.push(share.sharedWithUserId);
    return ids;
  }

  /** Express middleware: after a successful write, tell everyone who can see what changed. */
  function middleware(req, res, next) {
    // ensure-defaults is a POST the app makes on every calendar load: not a change.
    if (WRITES.has(req.method) && WATCHED.test(pathOf(req)) && !pathOf(req).includes("ensure-defaults")) {
      res.on("finish", () => {
        try {
          if (res.statusCode >= 300 || !req.auth) return;
          const kind = pathOf(req).split("/")[1];
          if (kind === "notes" || kind === "note-shares") {
            send(noteRecipients(req), { type: "changed", kind: "notes", by: req.auth.userId });
            return;
          }
          if (kind === "calendars") {
            send([req.auth.userId], { type: "changed", kind: "calendar", by: req.auth.userId });
            return;
          }
          const listId = listOf(req) ?? null;
          send(recipientsOf(listId, req.auth.userId), { type: "changed", kind: "tasks", listId, by: req.auth.userId });
        } catch (error) {
          logger?.warn?.({ err: error }, "live notify failed");
        }
      });
    }
    next();
  }

  return { issue, attach, middleware, send, close: () => wss.close() };
}
