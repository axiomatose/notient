import { nanoid } from 'nanoid';

export function createTaskListSharesRepository(db) {
  return {
    create({ listId, sharedByUserId, sharedWithUserId, permission }) {
      const id = `share-${nanoid(10)}`;
      const createdAt = Date.now();

      const stmt = db.prepare(`
        INSERT INTO task_list_shares (id, list_id, shared_by_user_id, shared_with_user_id, permission, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, listId, sharedByUserId, sharedWithUserId, permission, createdAt);

      return this.findById(id);
    },

    findById(id) {
      const stmt = db.prepare(`
        SELECT 
          id,
          list_id as listId,
          shared_by_user_id as sharedByUserId,
          shared_with_user_id as sharedWithUserId,
          permission,
          created_at as createdAt
        FROM task_list_shares
        WHERE id = ?
      `);

      return stmt.get(id);
    },

    findByListId(listId) {
      const stmt = db.prepare(`
        SELECT 
          s.id,
          s.list_id as listId,
          s.shared_by_user_id as sharedByUserId,
          s.shared_with_user_id as sharedWithUserId,
          s.permission,
          s.created_at as createdAt,
          u.email as sharedWithUserEmail,
          u.display_name as sharedWithDisplayName
        FROM task_list_shares s
        LEFT JOIN users u ON s.shared_with_user_id = u.id
        WHERE s.list_id = ?
        ORDER BY s.created_at DESC
      `);

      return stmt.all(listId);
    },

    findBySharedByUserId(userId) {
      const stmt = db.prepare(`
        SELECT 
          s.id,
          s.list_id as listId,
          s.shared_by_user_id as sharedByUserId,
          s.shared_with_user_id as sharedWithUserId,
          s.permission,
          s.created_at as createdAt,
          tl.name as listName,
          tl.color as listColor,
          u.email as sharedWithEmail,
          u.display_name as sharedWithDisplayName
        FROM task_list_shares s
        JOIN task_lists tl ON s.list_id = tl.id
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
          s.list_id as listId,
          s.shared_by_user_id as sharedByUserId,
          s.shared_with_user_id as sharedWithUserId,
          s.permission,
          s.created_at as createdAt,
          tl.name as listName,
          tl.color as listColor,
          tl.user_id as ownerId,
          u.email as sharedByEmail,
          u.display_name as sharedByDisplayName
        FROM task_list_shares s
        JOIN task_lists tl ON s.list_id = tl.id
        JOIN users u ON s.shared_by_user_id = u.id
        WHERE s.shared_with_user_id = ? AND tl.deleted_at IS NULL
        ORDER BY s.created_at DESC
      `);

      return stmt.all(userId);
    },

    findByListAndUser(listId, userId) {
      const stmt = db.prepare(`
        SELECT 
          id,
          list_id as listId,
          shared_by_user_id as sharedByUserId,
          shared_with_user_id as sharedWithUserId,
          permission,
          created_at as createdAt
        FROM task_list_shares
        WHERE list_id = ? AND shared_with_user_id = ?
      `);

      return stmt.get(listId, userId);
    },

    canUserAccessList(listId, userId) {
      const stmt = db.prepare(`
        SELECT permission
        FROM task_list_shares
        WHERE list_id = ? AND shared_with_user_id = ?
      `);

      const result = stmt.get(listId, userId);
      return result ? result.permission : null;
    },

    getSharedListsForUser(userId, { limit = 50, offset = 0, permission = null } = {}) {
      let query = `
        SELECT 
          tl.*,
          s.permission,
          s.created_at as sharedAt,
          u.email as sharedByEmail,
          u.display_name as sharedByDisplayName
        FROM task_lists tl
        JOIN task_list_shares s ON tl.id = s.list_id
        JOIN users u ON s.shared_by_user_id = u.id
        WHERE s.shared_with_user_id = ? AND tl.deleted_at IS NULL
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
        UPDATE task_list_shares
        SET permission = ?
        WHERE id = ?
      `);

      stmt.run(permission, id);
      return this.findById(id);
    },

    delete(id) {
      const stmt = db.prepare(`DELETE FROM task_list_shares WHERE id = ?`);
      stmt.run(id);
    },

    deleteByListId(listId) {
      const stmt = db.prepare(`DELETE FROM task_list_shares WHERE list_id = ?`);
      stmt.run(listId);
    },

    listSince({ userId, since }) {
      const stmt = db.prepare(`
        SELECT 
          id,
          list_id as listId,
          shared_by_user_id as sharedByUserId,
          shared_with_user_id as sharedWithUserId,
          permission,
          created_at as createdAt,
          created_at as updatedAt
        FROM task_list_shares
        WHERE (shared_by_user_id = ? OR shared_with_user_id = ?)
          AND created_at > ?
        ORDER BY created_at ASC
      `);
      return stmt.all(userId, userId, since);
    },

    countUnread(userId) {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM task_list_shares
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
          s.list_id as listId,
          s.created_at as createdAt,
          s.is_read as isRead,
          u.email as sharedByUserEmail,
          u.display_name as sharedByDisplayName
        FROM task_list_shares s
        LEFT JOIN users u ON s.shared_by_user_id = u.id
        WHERE s.shared_with_user_id = ?
        ORDER BY s.created_at DESC
      `);
      return stmt.all(userId);
    },

    markAsRead(id) {
      const stmt = db.prepare(`
        UPDATE task_list_shares
        SET is_read = 1
        WHERE id = ?
      `);
      stmt.run(id);
      return this.findById(id);
    },
  };
}
