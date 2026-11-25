/**
 * Component: Search repository
 * Documentation: documentation/backend/database.md
 *
 * One query over a person's own notes, tasks and events. Notes come from the notes repository (their text is in
 * files); tasks and events are matched in SQL. A vault note matches on its title and tags only, never its body.
 */
const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createSearchRepository(db, { notes }) {
  const taskStmt = db.prepare(`
    SELECT t.id, t.title, t.list_id AS listId, t.parent_id AS parentId, t.is_done AS isDone, l.name AS listName
    FROM tasks t
    JOIN task_lists l ON l.id = t.list_id
    WHERE t.user_id = @userId AND (t.deleted_at IS NULL OR t.deleted_at = 0)
      AND (l.deleted_at IS NULL OR l.deleted_at = 0)
      AND (t.title LIKE @like ESCAPE '\\' OR t.tags LIKE @like ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM task_notes n WHERE n.task_id = t.id AND n.body LIKE @like ESCAPE '\\'))
    ORDER BY t.is_done ASC, t.updated_at DESC
    LIMIT @limit
  `);
  const eventStmt = db.prepare(`
    SELECT e.id, e.title, e.start_time AS startTime, e.all_day AS allDay, e.location
    FROM calendar_events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE c.user_id = @userId AND e.deleted_at IS NULL
      AND (e.title LIKE @like ESCAPE '\\' OR e.location LIKE @like ESCAPE '\\' OR e.description LIKE @like ESCAPE '\\')
    ORDER BY ABS(e.start_time - @now) ASC
    LIMIT @limit
  `);

  const snippet = (body, q) => {
    const text = String(body ?? "").replace(/\s+/g, " ");
    const at = text.toLowerCase().indexOf(q);
    if (at < 0) return text.slice(0, 80);
    const from = Math.max(0, at - 30);
    return `${from > 0 ? "…" : ""}${text.slice(from, at + q.length + 50)}`;
  };

  return {
    search({ userId, q, limit = 8 }) {
      const needle = String(q ?? "").trim().toLowerCase();
      if (needle === "") return { notes: [], tasks: [], events: [] };
      const like = `%${escapeLike(needle)}%`;
      const found = [];
      for (const n of notes.list({ userId, includeDeleted: false })) {
        const vault = Array.isArray(n.tags) && n.tags.includes("vault");
        const inTitle = String(n.title ?? "").toLowerCase().includes(needle);
        const inTags = (n.tags ?? []).some((t) => String(t).toLowerCase().includes(needle));
        const inBody = !vault && String(n.bodyMarkdown ?? n.body ?? "").toLowerCase().includes(needle);
        if (inTitle || inTags || inBody) {
          found.push({ id: n.id, title: n.title, folder: n.folder ?? "", snippet: inBody && !inTitle ? snippet(n.bodyMarkdown ?? n.body, needle) : "", vault });
        }
      }
      return {
        notes: found.slice(0, limit),
        tasks: taskStmt.all({ userId, like, limit }).map((t) => ({ ...t, isDone: t.isDone === 1 })),
        events: eventStmt.all({ userId, like, now: Date.now(), limit }).map((e) => ({ ...e, allDay: e.allDay === 1 })),
      };
    },
  };
}
