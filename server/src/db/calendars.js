import { nanoid } from 'nanoid';
import { encrypt, decrypt } from '../utils/encryption.js';

export function createCalendarRepository(db) {
  return {
    // Calendar CRUD operations
    async createCalendar(userId, data) {
      const id = nanoid();
      const now = Date.now();
      
      let password = data.password || null;
      if (password) {
        password = await encrypt(password, userId);
      }
      
      const stmt = db.prepare(`
        INSERT INTO calendars (
          id, user_id, name, color, type, url, username, password,
          is_active, sort_order, created_at, updated_at, version, sync_kind
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        id,
        userId,
        data.name,
        data.color || '#007AFF',
        data.type,
        data.url || null,
        data.username || null,
        password,
        data.isActive !== false ?1 : 0,
        data.sortOrder || 0,
        now,
        now,
        1,
        data.syncKind || null
      );
      
      return this.getCalendar(id);
    },

    // Every subscribed calendar of every user (for the periodic sync).
    listSyncable() {
      return db.prepare('SELECT id FROM calendars WHERE sync_kind IS NOT NULL AND deleted_at IS NULL AND is_active = 1').all().map((r) => r.id);
    },

    // Replace a subscribed calendar's events with a fresh fetch (or record why there is none).
    replaceSynced(calendarId, events, error) {
      const now = Date.now();
      const run = db.transaction(() => {
        if (error) {
          db.prepare('UPDATE calendars SET sync_error = ?, updated_at = ? WHERE id = ?').run(error, now, calendarId);
          return;
        }
        db.prepare('DELETE FROM calendar_events WHERE calendar_id = ?').run(calendarId);
        const insert = db.prepare(`
          INSERT INTO calendar_events (id, calendar_id, title, description, start_time, end_time, all_day, location, recurrence, attendees, url, external_id, created_at, updated_at, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?, 1)
        `);
        for (const e of events) {
          insert.run(nanoid(), calendarId, e.title, e.description || null, e.startTime, e.endTime, e.allDay ? 1 : 0, e.location || null, e.url || null, e.externalId, now, now);
        }
        db.prepare('UPDATE calendars SET last_sync = ?, sync_error = NULL, updated_at = ? WHERE id = ?').run(now, now, calendarId);
      });
      run();
    },
    
    async getCalendar(id) {
      const stmt = db.prepare('SELECT * FROM calendars WHERE id = ? AND deleted_at IS NULL');
      const calendar = stmt.get(id);
      
      if (!calendar) return null;
      
      return await this.normalizeCalendar(calendar);
    },
    
    async listCalendars(userId, { includeDeleted = false, since = null } = {}) {
      let query = `
        SELECT * FROM calendars 
        WHERE user_id = ? 
      `;
      const params = [userId];
      
      if (!includeDeleted) {
        query += ' AND deleted_at IS NULL';
      }
      
      if (since) {
        query += ' AND updated_at > ?';
        params.push(since);
      }
      
      query += ' ORDER BY sort_order ASC, created_at ASC';
      
      const stmt = db.prepare(query);
      const calendars = stmt.all(...params);
      
      const normalizedCalendars = await Promise.all(
        calendars.map(c => this.normalizeCalendar(c))
      );
      
      return {
        calendars: normalizedCalendars,
        count: calendars.length,
        since,
      };
    },
    
    async updateCalendar(id, data) {
      const now = Date.now();
      
      // Get current calendar
      const current = await this.getCalendar(id);
      if (!current) return null;
      
      // Handle password: if provided in data, encrypt it. 
      // If not provided, but we are updating it indirectly (unlikely but safe), we keep it.
      let passwordToStore = undefined;
      if (data.password !== undefined) {
        passwordToStore = data.password ? await encrypt(data.password, current.userId) : null;
      }
      
      const stmt = db.prepare(`
        UPDATE calendars SET
          name = COALESCE(?, name),
          color = COALESCE(?, color),
          type = COALESCE(?, type),
          url = COALESCE(?, url),
          username = COALESCE(?, username),
          password = COALESCE(?, password),
          is_active = COALESCE(?, is_active),
          sort_order = COALESCE(?, sort_order),
          last_sync = COALESCE(?, last_sync),
          updated_at = ?,
          version = version + 1
        WHERE id = ? AND deleted_at IS NULL
      `);
      
      const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : current.isActive;
      
      stmt.run(
        data.name ?? null,
        data.color ?? null,
        data.type ?? null,
        data.url ?? null,
        data.username ?? null,
        passwordToStore ?? (data.password === undefined ? undefined : null),
        isActive ? 1 : 0,
        data.sortOrder ?? null,
        data.lastSync ?? null,
        now,
        id
      );
      
      return this.getCalendar(id);
    },
    
    async deleteCalendar(id) {
      const now = Date.now();
      const stmt = db.prepare(`
        UPDATE calendars SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `);
      stmt.run(now, now, id);
      
      return this.getCalendar(id);
    },
    
    async setDefaultCalendars(userId) {
      const calendars = await this.listCalendars(userId);
      
      // Check if default calendars already exist
      const hasEvents = calendars.calendars.some(c => c.type === 'internal');
      const hasTasks = calendars.calendars.some(c => c.type === 'tasks');
      
      if (!hasEvents) {
        await this.createCalendar(userId, {
          name: 'Notient Events',
          color: '#007AFF',
          type: 'internal',
          isActive: true,
          sortOrder: 0,
        });
      }
      
      if (!hasTasks) {
        await this.createCalendar(userId, {
          name: 'Tasks Due',
          color: '#34C759',
          type: 'tasks',
          isActive: true,
          sortOrder: 1,
        });
      }
    },
    
    // Normalize calendar for API response
    async normalizeCalendar(calendar) {
      let password = calendar.password;
      if (password) {
        try {
          password = await decrypt(password, calendar.user_id);
        } catch (e) {
          // If decryption fails, it might be plaintext from a manual update
          // or a different key. We keep it as-is (with a warning)
          console.warn(`[Calendars] Failed to decrypt password for calendar ${calendar.id}`);
        }
      }

      return {
        id: calendar.id,
        userId: calendar.user_id,
        name: calendar.name,
        color: calendar.color,
        type: calendar.type,
        url: calendar.url,
        username: calendar.username,
        password,
        lastSync: calendar.last_sync,
        // A subscribed calendar ("ics" link or "caldav" account) is read-only: its events come from the server it names.
        syncKind: calendar.sync_kind ?? null,
        syncError: calendar.sync_error ?? null,
        readOnly: Boolean(calendar.sync_kind),
        isActive: calendar.is_active === 1,
        sortOrder: calendar.sort_order,
        createdAt: calendar.created_at,
        updatedAt: calendar.updated_at,
        deletedAt: calendar.deleted_at,
        version: calendar.version,
      };
    },
  };
}
