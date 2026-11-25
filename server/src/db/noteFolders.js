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

  const usedStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at = 0) AND (folder = ? OR substr(folder, 1, length(?) + 1) = ? || '/')",
  );
  const deleteStmt = db.prepare("DELETE FROM note_folders WHERE user_id = ? AND (path = ? OR substr(path, 1, length(?) + 1) = ? || '/')");

  return {
    list(userId) {
      return listStmt.all(userId).map((r) => r.path);
    },
    add(userId, path) {
      insertStmt.run(userId, path, Date.now());
    },
    // Only an empty folder goes (no live note in it or below it); its empty subfolders go with it. False when it still holds notes.
    removeEmpty(userId, path) {
      if (usedStmt.get(userId, path, path, path).n > 0) return false;
      deleteStmt.run(userId, path, path, path);
      return true;
    },
  };
}
