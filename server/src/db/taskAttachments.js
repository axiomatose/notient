import { nanoid } from "nanoid";

export function createTaskAttachmentsRepository(db) {
  return {
    async create(taskAttachment) {
      const id = nanoid();
      const now = Date.now();
      
      const stmt = db.prepare(`
        INSERT INTO task_attachments (
          id, task_id, type, name, url, file_path, file_size, mime_type,
          location_lat, location_lng, location_name, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        taskAttachment.taskId,
        taskAttachment.type,
        taskAttachment.name || null,
        taskAttachment.url || null,
        taskAttachment.filePath || null,
        taskAttachment.fileSize || null,
        taskAttachment.mimeType || null,
        taskAttachment.locationLat || null,
        taskAttachment.locationLng || null,
        taskAttachment.locationName || null,
        now,
        taskAttachment.createdBy
      );

      return { id, ...taskAttachment, createdAt: now };
    },

    async findById(id) {
      const stmt = db.prepare(`
        SELECT ta.*, u.email as created_by_email, u.display_name as created_by_display_name
        FROM task_attachments ta
        LEFT JOIN users u ON ta.created_by = u.id
        WHERE ta.id = ?
      `);
      const row = stmt.get(id);
      return row ? this.mapRow(row) : null;
    },

    async findByTaskId(taskId, type = null) {
      let query = `
        SELECT ta.*, u.email as created_by_email, u.display_name as created_by_display_name
        FROM task_attachments ta
        LEFT JOIN users u ON ta.created_by = u.id
        WHERE ta.task_id = ?
      `;
      
      const params = [taskId];
      
      if (type) {
        query += ` AND ta.type = ?`;
        params.push(type);
      }
      
      query += ` ORDER BY ta.created_at DESC`;
      
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(row => this.mapRow(row));
    },

    async findByUserId(userId, type = null, options = {}) {
      const { limit = 50, offset = 0 } = options;
      
      let query = `
        SELECT ta.*, t.title as task_title, t.list_id, t.section_id,
               u.email as created_by_email, u.display_name as created_by_display_name
        FROM task_attachments ta
        JOIN tasks t ON ta.task_id = t.id
        LEFT JOIN users u ON ta.created_by = u.id
        WHERE ta.created_by = ?
        AND t.deleted_at IS NULL
      `;
      
      const params = [userId];
      
      if (type) {
        query += ` AND ta.type = ?`;
        params.push(type);
      }
      
      query += ` ORDER BY ta.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(row => this.mapRowWithTaskInfo(row));
    },

    async createImage(taskId, filePath, url, fileName, fileSize, mimeType, createdBy) {
      return this.create({
        taskId,
        type: 'image',
        name: fileName,
        url,
        filePath,
        fileSize,
        mimeType,
        createdBy,
      });
    },

    async createFile(taskId, filePath, url, fileName, fileSize, mimeType, createdBy) {
      return this.create({
        taskId,
        type: 'file',
        name: fileName,
        url,
        filePath,
        fileSize,
        mimeType,
        createdBy,
      });
    },

    async createLocation(taskId, lat, lng, name, createdBy) {
      return this.create({
        taskId,
        type: 'location',
        locationLat: lat,
        locationLng: lng,
        locationName: name,
        createdBy,
      });
    },

    async updateLocation(id, lat, lng, name) {
      const stmt = db.prepare(`
        UPDATE task_attachments 
        SET location_lat = ?, location_lng = ?, location_name = ?
        WHERE id = ? AND type = 'location'
      `);
      stmt.run(lat, lng, name, id);
      
      return this.findById(id);
    },

    async delete(id) {
      const stmt = db.prepare(`
        DELETE FROM task_attachments WHERE id = ?
      `);
      stmt.run(id);
    },

    async deleteByTaskId(taskId) {
      const stmt = db.prepare(`
        DELETE FROM task_attachments WHERE task_id = ?
      `);
      stmt.run(taskId);
    },

    async getAttachmentStats(taskId) {
      const stmt = db.prepare(`
        SELECT 
          type,
          COUNT(*) as count,
          SUM(file_size) as total_size
        FROM task_attachments 
        WHERE task_id = ?
        GROUP BY type
      `);
      const rows = stmt.all(taskId);
      
      return rows.reduce((stats, row) => {
        stats[row.type] = {
          count: row.count,
          totalSize: row.total_size || 0,
        };
        return stats;
      }, {});
    },

    async getLocationForTask(taskId) {
      const stmt = db.prepare(`
        SELECT * FROM task_attachments 
        WHERE task_id = ? AND type = 'location'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const row = stmt.get(taskId);
      return row ? this.mapRow(row) : null;
    },

    async getImagesForTask(taskId) {
      return this.findByTaskId(taskId, 'image');
    },

    async getFilesForTask(taskId) {
      return this.findByTaskId(taskId, 'file');
    },

    async getLocationsForTask(taskId) {
      return this.findByTaskId(taskId, 'location');
    },

    async searchByName(userId, searchTerm, type = null) {
      let query = `
        SELECT ta.*, t.title as task_title, t.list_id, t.section_id,
               u.email as created_by_email, u.display_name as created_by_display_name
        FROM task_attachments ta
        JOIN tasks t ON ta.task_id = t.id
        LEFT JOIN users u ON ta.created_by = u.id
        WHERE ta.created_by = ?
        AND ta.name LIKE ?
        AND t.deleted_at IS NULL
      `;
      
      const params = [userId, `%${searchTerm}%`];
      
      if (type) {
        query += ` AND ta.type = ?`;
        params.push(type);
      }
      
      query += ` ORDER BY ta.created_at DESC`;
      
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);
      return rows.map(row => this.mapRowWithTaskInfo(row));
    },

    mapRow(row) {
      return {
        id: row.id,
        taskId: row.task_id,
        type: row.type,
        name: row.name,
        url: row.url,
        filePath: row.file_path,
        fileSize: row.file_size,
        mimeType: row.mime_type,
        locationLat: row.location_lat,
        locationLng: row.location_lng,
        locationName: row.location_name,
        createdAt: row.created_at,
        createdBy: row.created_by,
        createdByEmail: row.created_by_email,
        createdByDisplayName: row.created_by_display_name,
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
      };
    },
  };
}
