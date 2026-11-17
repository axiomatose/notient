import { nanoid } from "nanoid";

export function createTaskSharesRepository(db) {
  return {
    async create(taskShare) {
      const id = nanoid();
      const now = Date.now();
      
      const stmt = db.prepare(`
        INSERT INTO task_shares (
          id, task_id, shared_by_user_id, shared_with_user_id, permission, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        taskShare.taskId,
        taskShare.sharedByUserId,
        taskShare.sharedWithUserId,
        taskShare.permission,
        now
      );

      return { id, ...taskShare, createdAt: now };
    },

    async findById(id) {
      const stmt = db.prepare(`
        SELECT * FROM task_shares WHERE id = ?
      `);
      const row = stmt.get(id);
      return row ? this.mapRow(row) : null;
    },

    async findByTaskId(taskId) {
      const stmt = db.prepare(`
        SELECT ts.*, 
               u_shared_by.email as shared_by_email,
               u_shared_by.display_name as shared_by_display_name,
               u_shared_with.email as shared_with_email,
               u_shared_with.display_name as shared_with_display_name
        FROM task_shares ts
        LEFT JOIN users u_shared_by ON ts.shared_by_user_id = u_shared_by.id
        LEFT JOIN users u_shared_with ON ts.shared_with_user_id = u_shared_with.id
        WHERE ts.task_id = ?
        ORDER BY ts.created_at DESC
      `);
      const rows = stmt.all(taskId);
      return rows.map(row => this.mapRowWithUsers(row));
    },

    async findByUserId(userId, permission = null) {
      let query = `
        SELECT ts.*, t.title as task_title, t.list_id, t.section_id,
               u_shared_by.email as shared_by_email,
               u_shared_by.display_name as shared_by_display_name
        FROM task_shares ts
        LEFT JOIN tasks t ON ts.task_id = t.id
        LEFT JOIN users u_shared_by ON ts.shared_by_user_id = u_shared_by.id
        WHERE ts.shared_with_user_id = ?
        AND t.deleted_at IS NULL
      `;
      
      const params = [userId];
      
      if (permission) {
        query += ` AND ts.permission = ?`;
        params.push(permission);
      }
      
      query += ` ORDER BY ts.created_at DESC`;
      
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(row => this.mapRowWithTaskInfo(row));
    },

    async findBySharedByUserId(userId) {
      const stmt = db.prepare(`
        SELECT ts.*, t.title as task_title, t.list_id, t.section_id,
               u_shared_with.email as shared_with_email,
               u_shared_with.display_name as shared_with_display_name
        FROM task_shares ts
        LEFT JOIN tasks t ON ts.task_id = t.id
        LEFT JOIN users u_shared_with ON ts.shared_with_user_id = u_shared_with.id
        WHERE ts.shared_by_user_id = ?
        AND t.deleted_at IS NULL
        ORDER BY ts.created_at DESC
      `);
      const rows = stmt.all(userId);
      return rows.map(row => this.mapRowWithSharedUserInfo(row));
    },

    async findByTaskAndUser(taskId, userId) {
      const stmt = db.prepare(`
        SELECT * FROM task_shares 
        WHERE task_id = ? AND shared_with_user_id = ?
      `);
      const row = stmt.get(taskId, userId);
      return row ? this.mapRow(row) : null;
    },

    async updatePermission(id, permission) {
      const stmt = db.prepare(`
        UPDATE task_shares 
        SET permission = ? 
        WHERE id = ?
      `);
      stmt.run(permission, id);
      
      return this.findById(id);
    },

    async delete(id) {
      const stmt = db.prepare(`
        DELETE FROM task_shares WHERE id = ?
      `);
      stmt.run(id);
    },

    async deleteByTaskId(taskId) {
      const stmt = db.prepare(`
        DELETE FROM task_shares WHERE task_id = ?
      `);
      stmt.run(taskId);
    },

    async deleteByTaskAndUser(taskId, userId) {
      const stmt = db.prepare(`
        DELETE FROM task_shares WHERE task_id = ? AND shared_with_user_id = ?
      `);
      stmt.run(taskId, userId);
    },

    async getSharedTasksForUser(userId, options = {}) {
      const { limit = 50, offset = 0, permission = null } = options;
      
      let query = `
        SELECT t.*, ts.permission, ts.shared_by_user_id, ts.shared_with_user_id,
               u_shared_by.display_name as shared_by_display_name
        FROM task_shares ts
        JOIN tasks t ON ts.task_id = t.id
        LEFT JOIN users u_shared_by ON ts.shared_by_user_id = u_shared_by.id
        WHERE ts.shared_with_user_id = ?
        AND t.deleted_at IS NULL
      `;
      
      const params = [userId];
      
      if (permission) {
        query += ` AND ts.permission = ?`;
        params.push(permission);
      }
      
      query += ` ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(row => this.mapRowWithSharedTask(row));
    },

    async canUserAccessTask(taskId, userId) {
      const stmt = db.prepare(`
        SELECT permission FROM task_shares 
        WHERE task_id = ? AND shared_with_user_id = ?
      `);
      const row = stmt.get(taskId, userId);
      return row ? row.permission : null;
    },

    listSince({ userId, since }) {
      const stmt = db.prepare(`
        SELECT *
        FROM task_shares
        WHERE (shared_by_user_id = ? OR shared_with_user_id = ?)
          AND created_at > ?
        ORDER BY created_at ASC
      `);
      const rows = stmt.all(userId, userId, since);
      return rows.map(row => ({
          ...this.mapRow(row),
          updatedAt: row.created_at
      }));
    },

    mapRow(row) {
      return {
        id: row.id,
        taskId: row.task_id,
        sharedByUserId: row.shared_by_user_id,
        sharedWithUserId: row.shared_with_user_id,
        permission: row.permission,
        createdAt: row.created_at,
      };
    },

    mapRowWithUsers(row) {
      const base = this.mapRow(row);
      return {
        ...base,
        sharedBy: {
          email: row.shared_by_email,
          displayName: row.shared_by_display_name,
        },
        sharedWith: {
          email: row.shared_with_email,
          displayName: row.shared_with_display_name,
        },
      };
    },

    mapRowWithTaskInfo(row) {
      const base = this.mapRow(row);
      return {
        ...base,
        task: {
          title: row.task_title,
          listId: row.list_id,
          sectionId: row.section_id,
        },
        sharedBy: {
          email: row.shared_by_email,
          displayName: row.shared_by_display_name,
        },
      };
    },

    mapRowWithSharedUserInfo(row) {
      const base = this.mapRow(row);
      return {
        ...base,
        task: {
          title: row.task_title,
          listId: row.list_id,
          sectionId: row.section_id,
        },
        sharedWith: {
          email: row.shared_with_email,
          displayName: row.shared_with_display_name,
        },
      };
    },

    mapRowWithSharedTask(row) {
      return {
        id: row.id,
        userId: row.user_id,
        listId: row.list_id,
        parentId: row.parent_id,
        sectionId: row.section_id,
        title: row.title,
        notes: row.notes,
        isDone: Boolean(row.is_done),
        dueAt: row.due_at,
        remindAt: row.remind_at,
        priority: row.priority,
        tags: row.tags ? JSON.parse(row.tags) : [],
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        version: row.version,
        sharedWithUserId: row.shared_with_user_id,
        sharedByUserId: row.shared_by_user_id,
        permission: row.permission,
        sharedByDisplayName: row.shared_by_display_name,
        locationName: row.location_name,
        locationLat: row.location_lat,
        locationLng: row.location_lng,
        sharedWith: row.shared_with ? JSON.parse(row.shared_with) : [],
        updatedBy: row.updated_by,
      };
    },

    countUnread(userId) {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM task_shares
        WHERE shared_with_user_id = ? AND is_read = 0
      `);
      const result = stmt.get(userId);
      return result ? result.count : 0;
    },

    findSharedWithUser(userId) {
      const stmt = db.prepare(`
        SELECT 
          ts.*,
          ts.shared_with_user_id as sharedWithUserId,
          ts.shared_by_user_id as sharedByUserId,
          ts.task_id as taskId,
          ts.created_at as createdAt,
          ts.is_read as isRead,
          u.email as sharedByUserEmail,
          u.display_name as sharedByDisplayName
        FROM task_shares ts
        LEFT JOIN users u ON ts.shared_by_user_id = u.id
        WHERE ts.shared_with_user_id = ?
        ORDER BY ts.created_at DESC
      `);
      return stmt.all(userId);
    },

    markAsRead(id) {
      const stmt = db.prepare(`
        UPDATE task_shares
        SET is_read = 1
        WHERE id = ?
      `);
      stmt.run(id);
      return this.findById(id);
    },
  };
}
