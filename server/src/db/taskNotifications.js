import { nanoid } from "nanoid";

export function createTaskNotificationsRepository(db) {
  return {
    async create(taskNotification) {
      const id = nanoid();
      const now = Date.now();
      
      const stmt = db.prepare(`
        INSERT INTO task_notifications (
          id, task_id, user_id, type, scheduled_at, sent_at, is_read, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        taskNotification.taskId,
        taskNotification.userId,
        taskNotification.type,
        taskNotification.scheduledAt,
        taskNotification.sentAt || null,
        taskNotification.isRead || 0,
        taskNotification.payload ? JSON.stringify(taskNotification.payload) : null,
        now
      );

      return { id, ...taskNotification, createdAt: now };
    },

    async findById(id) {
      const stmt = db.prepare(`
        SELECT * FROM task_notifications WHERE id = ?
      `);
      const row = stmt.get(id);
      return row ? this.mapRow(row) : null;
    },

    async findByUserId(userId, options = {}) {
      const { limit = 50, offset = 0, unreadOnly = false, type = null } = options;
      
      let query = `
        SELECT * FROM task_notifications 
        WHERE user_id = ? 
        AND deleted_at IS NULL
      `;
      const params = [userId];

      if (unreadOnly) {
        query += ` AND is_read = 0`;
      }

      if (type) {
        query += ` AND type = ?`;
        params.push(type);
      }

      query += ` ORDER BY scheduled_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(row => this.mapRow(row));
    },

    async findPendingNotifications(beforeTime = Date.now()) {
      const stmt = db.prepare(`
        SELECT * FROM task_notifications 
        WHERE scheduled_at <= ? 
        AND sent_at IS NULL
        ORDER BY scheduled_at ASC
      `);
      const rows = stmt.all(beforeTime);
      return rows.map(row => this.mapRow(row));
    },

    async markAsSent(id, sentAt = Date.now()) {
      const stmt = db.prepare(`
        UPDATE task_notifications 
        SET sent_at = ? 
        WHERE id = ?
      `);
      stmt.run(sentAt, id);
    },

    async markAsRead(id, readAt = Date.now()) {
      const stmt = db.prepare(`
        UPDATE task_notifications 
        SET is_read = 1, sent_at = COALESCE(sent_at, ?)
        WHERE id = ?
      `);
      stmt.run(readAt, id);
    },

    async markAllAsRead(userId) {
      const stmt = db.prepare(`
        UPDATE task_notifications 
        SET is_read = 1 
        WHERE user_id = ? AND is_read = 0
      `);
      stmt.run(userId);
    },

    async delete(id) {
      const stmt = db.prepare(`
        UPDATE task_notifications 
        SET deleted_at = ? 
        WHERE id = ?
      `);
      const now = Date.now();
      stmt.run(now, id);
    },

    async deleteByTaskId(taskId) {
      const stmt = db.prepare(`
        UPDATE task_notifications 
        SET deleted_at = ? 
        WHERE task_id = ?
      `);
      const now = Date.now();
      stmt.run(now, taskId);
    },

    async getScheduledNotificationsForUser(userId, afterTime = Date.now()) {
      const stmt = db.prepare(`
        SELECT * FROM task_notifications 
        WHERE user_id = ? 
        AND scheduled_at > ? 
        AND sent_at IS NULL
        AND deleted_at IS NULL
        ORDER BY scheduled_at ASC
      `);
      const rows = stmt.all(userId, afterTime);
      return rows.map(row => this.mapRow(row));
    },

    async countUnread(userId) {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM task_notifications 
        WHERE user_id = ? 
        AND is_read = 0 
        AND deleted_at IS NULL
      `);
      const result = stmt.get(userId);
      return result ? result.count : 0;
    },

    mapRow(row) {
      return {
        id: row.id,
        taskId: row.task_id,
        userId: row.user_id,
        type: row.type,
        scheduledAt: row.scheduled_at,
        sentAt: row.sent_at,
        isRead: Boolean(row.is_read),
        payload: row.payload ? JSON.parse(row.payload) : null,
        createdAt: row.created_at,
        deletedAt: row.deleted_at,
      };
    },
  };
}
