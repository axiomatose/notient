/**
 * Component: Note folders repository
 * Documentation: documentation/backend/database.md
 *
 * Folders a person made on purpose, so one can exist before any note is filed in it. A note's folder is still just a
 * path on the note; this table only keeps the empty ones (and the list merges both).
 */
export function createNoteFoldersRepository(db) {
  const listStmt = db.prepare("SELECT path FROM note_folders WHERE user_id = ? ORDER BY path COLLATE NOCASE");
  const insertStmt = db.prepare("INSERT OR IGNORE INTO note_folders (user_id, path, created_at) VALUES (?, ?, ?)");

  return {
    list(userId) {
      return listStmt.all(userId).map((r) => r.path);
    },
    add(userId, path) {
      insertStmt.run(userId, path, Date.now());
    },
  };
}
