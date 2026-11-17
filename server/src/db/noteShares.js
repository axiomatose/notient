import { nanoid } from 'nanoid';

export function createNoteSharesRepository(db) {
  return {
    create({ noteId, sharedByUserId, sharedWithUserId, permission }) {
      const id = `share-${nanoid(10)}`;
      const createdAt = Date.now();

      const stmt = db.prepare(`
        INSERT INTO note_shares (id, note_id, shared_by_user_id, shared_with_user_id, permission, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, noteId, sharedByUserId, sharedWithUserId, permission, createdAt);

      return this.findById(id);
    },

    findById(id) {
      const stmt = db.prepare(`
        SELECT 
          id,
          note_id as noteId,
          shared_by_user_id as sharedByUserId,
          shared_with_user_id as sharedWithUserId,
          permission,
          created_at as createdAt
        FROM note_shares
        WHERE id = ?
      `);

      return stmt.get(id);
    },

    findByNoteId(noteId) {
      const stmt = db.prepare(`
        SELECT 
          s.id,
          s.note_id as noteId,
          s.shared_by_user_id as sharedByUserId,
          s.shared_with_user_id as sharedWithUserId,
          s.permission,
          s.created_at as createdAt,
          u.email as sharedWithUserEmail,
          u.display_name as sharedWithDisplayName
        FROM note_shares s
        LEFT JOIN users u ON s.shared_with_user_id = u.id
        WHERE s.note_id = ?
        ORDER BY s.created_at DESC
      `);

      return stmt.all(noteId);
    },

    findBySharedByUserId(userId) {
      const stmt = db.prepare(`
        SELECT 
          s.id,
          s.note_id as noteId,
          s.shared_by_user_id as sharedByUserId,
          s.shared_with_user_id as sharedWithUserId,
          s.permission,
          s.created_at as createdAt,
          n.title as noteTitle,
          u.email as sharedWithEmail,
          u.display_name as sharedWithDisplayName
        FROM note_shares s
        JOIN notes n ON s.note_id = n.id
        JOIN users u ON s.shared_with_user_id = u.id
        WHERE s.shared_by_user_id = ?
        ORDER BY s.created_at DESC
      `);

      return stmt.all(userId);
    },

    findBySharedWithUserId(userId) {
      const stmt = db.prepare(`
        SELECT 
          s.id,
          s.note_id as noteId,
          s.shared_by_user_id as sharedByUserId,
          s.shared_with_user_id as sharedWithUserId,
          s.permission,
          s.created_at as createdAt,
          n.title as noteTitle,
          n.user_id as ownerId,
          u.email as sharedByEmail,
          u.display_name as sharedByDisplayName
        FROM note_shares s
        JOIN notes n ON s.note_id = n.id
        JOIN users u ON s.shared_by_user_id = u.id
        WHERE s.shared_with_user_id = ? AND n.deleted_at IS NULL
        ORDER BY s.created_at DESC
      `);

      return stmt.all(userId);
    },

    findByNoteAndUser(noteId, userId) {
      const stmt = db.prepare(`
        SELECT 
          id,
          note_id as noteId,
          shared_by_user_id as sharedByUserId,
          shared_with_user_id as sharedWithUserId,
          permission,
          created_at as createdAt
        FROM note_shares
        WHERE note_id = ? AND shared_with_user_id = ?
      `);

      return stmt.get(noteId, userId);
    },

    canUserAccessNote(noteId, userId) {
      const stmt = db.prepare(`
        SELECT permission
        FROM note_shares
        WHERE note_id = ? AND shared_with_user_id = ?
      `);

      const result = stmt.get(noteId, userId);
      return result ? result.permission : null;
    },

    getSharedNotesForUser(userId, { limit = 50, offset = 0, permission = null } = {}) {
      let query = `
        SELECT 
          n.*,
          s.permission,
          s.created_at as sharedAt,
          u.email as sharedByEmail,
          u.display_name as sharedByDisplayName
        FROM notes n
        JOIN note_shares s ON n.id = s.note_id
        JOIN users u ON s.shared_by_user_id = u.id
        WHERE s.shared_with_user_id = ? AND n.deleted_at IS NULL
      `;

      const params = [userId];

      if (permission) {
        query += ` AND s.permission = ?`;
        params.push(permission);
      }

      query += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const stmt = db.prepare(query);
      return stmt.all(...params);
    },

    updatePermission(id, permission) {
      const stmt = db.prepare(`
        UPDATE note_shares
        SET permission = ?
        WHERE id = ?
      `);

      stmt.run(permission, id);
      return this.findById(id);
    },

    delete(id) {
      const stmt = db.prepare(`DELETE FROM note_shares WHERE id = ?`);
      stmt.run(id);
    },

    deleteByNoteId(noteId) {
      const stmt = db.prepare(`DELETE FROM note_shares WHERE note_id = ?`);
      stmt.run(noteId);
    },

    countUnread(userId) {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM note_shares
        WHERE shared_with_user_id = ? AND is_read = 0
      `);
      const result = stmt.get(userId);
      return result ? result.count : 0;
    },

    findSharedWithUser(userId) {
      const stmt = db.prepare(`
        SELECT 
          s.*,
          s.shared_with_user_id as sharedWithUserId,
          s.shared_by_user_id as sharedByUserId,
          s.note_id as noteId,
          s.created_at as createdAt,
          s.is_read as isRead,
          u.email as sharedByUserEmail,
          u.display_name as sharedByDisplayName
        FROM note_shares s
        LEFT JOIN users u ON s.shared_by_user_id = u.id
        WHERE s.shared_with_user_id = ?
        ORDER BY s.created_at DESC
      `);
      return stmt.all(userId);
    },

    markAsRead(id) {
      const stmt = db.prepare(`
        UPDATE note_shares
        SET is_read = 1
        WHERE id = ?
      `);
      stmt.run(id);
      return this.findById(id);
    },
  };
}
