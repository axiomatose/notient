/**
 * Component: Task notes repository
 * Documentation: documentation/backend/database.md
 *
 * A task's notes are a thread: each note is its own row with its author and time.
 */
import { nanoid } from "nanoid";

export function createTaskNotesRepository(db) {
  const listStmt = db.prepare(`
    SELECT n.id, n.task_id, n.user_id, n.body, n.created_at,
           u.email, u.display_name, u.avatar_icon, u.avatar_color, u.avatar_url, u.avatar_updated_at
    FROM task_notes n
    LEFT JOIN users u ON u.id = n.user_id
    WHERE n.task_id = ?
    ORDER BY n.created_at ASC, n.rowid ASC
  `);
  const oneStmt = db.prepare(`
    SELECT n.id, n.task_id, n.user_id, n.body, n.created_at,
           u.email, u.display_name, u.avatar_icon, u.avatar_color, u.avatar_url, u.avatar_updated_at
    FROM task_notes n
    LEFT JOIN users u ON u.id = n.user_id
    WHERE n.id = ?
  `);
  const insertStmt = db.prepare(
    "INSERT INTO task_notes (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const deleteStmt = db.prepare("DELETE FROM task_notes WHERE id = ?");

  const map = (row) => ({
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      name: row.display_name || row.email || "",
      email: row.email ?? "",
      avatarIcon: row.avatar_icon ?? null,
      avatarColor: row.avatar_color ?? null,
      avatarUrl: row.avatar_url ?? null,
      avatarUpdatedAt: row.avatar_updated_at ?? null,
    },
  });

  return {
    list(taskId) {
      return listStmt.all(taskId).map(map);
    },
    find(id) {
      const row = oneStmt.get(id);
      return row ? map(row) : null;
    },
    create({ taskId, userId, body }) {
      const id = nanoid();
      insertStmt.run(id, taskId, userId, body, Date.now());
      return this.find(id);
    },
    remove(id) {
      deleteStmt.run(id);
    },
  };
}
