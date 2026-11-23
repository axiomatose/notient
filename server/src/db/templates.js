/**
 * Component: Templates repository
 * Documentation: documentation/backend/database.md
 *
 * A person's saved note and list templates: a name and a JSON payload the app reads back (a note: title and body;
 * a list: name, icon, color, sections and tasks). Built-in templates live in the app, not here.
 */
import { nanoid } from "nanoid";

export function createTemplatesRepository(db) {
  const listStmt = db.prepare("SELECT id, kind, name, payload, created_at FROM templates WHERE user_id = ? ORDER BY created_at ASC, rowid ASC");
  const oneStmt = db.prepare("SELECT id, user_id, kind, name, payload, created_at FROM templates WHERE id = ?");
  const insertStmt = db.prepare("INSERT INTO templates (id, user_id, kind, name, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const deleteStmt = db.prepare("DELETE FROM templates WHERE id = ? AND user_id = ?");

  const map = (row) => ({ id: row.id, kind: row.kind, name: row.name, payload: JSON.parse(row.payload), createdAt: row.created_at });

  return {
    list(userId) {
      return listStmt.all(userId).map(map);
    },
    create({ userId, kind, name, payload }) {
      const id = nanoid();
      insertStmt.run(id, userId, kind, name, JSON.stringify(payload), Date.now());
      return map(oneStmt.get(id));
    },
    remove(id, userId) {
      return deleteStmt.run(id, userId).changes > 0;
    },
  };
}
