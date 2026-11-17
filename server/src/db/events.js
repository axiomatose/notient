import { nanoid } from 'nanoid';

// Helper function - not a method
function normalizeEvent(event) {
  return {
    id: event.id,
    calendarId: event.calendar_id,
    userId: event.user_id,
    title: event.title,
    description: event.description,
    startTime: event.start_time,
    endTime: event.end_time,
    allDay: event.all_day === 1,
    location: event.location,
    recurrence: event.recurrence,
    alertMinutes: event.alert_minutes ?? null,
    url: event.url ?? null,
    attendees: event.attendees ? JSON.parse(event.attendees) : [],
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    deletedAt: event.deleted_at,
    version: event.version,
  };
}

function getEvent(db, id) {
  const stmt = db.prepare(`
    SELECT e.*, c.user_id 
    FROM calendar_events e
    JOIN calendars c ON e.calendar_id = c.id
    WHERE e.id = ? AND e.deleted_at IS NULL
  `);
  const event = stmt.get(id);
  
  if (!event) return null;
  
  return normalizeEvent(event);
}

function listEvents(db, calendarId, options = {}) {
  const { includeDeleted = false, since = null, startTime = null, endTime = null } = options;
  let query = `
    SELECT e.*, c.user_id 
    FROM calendar_events e
    JOIN calendars c ON e.calendar_id = c.id
    WHERE e.calendar_id = ?
  `;
  const params = [calendarId];
  
  if (!includeDeleted) {
    query += ' AND e.deleted_at IS NULL';
  }
  
  if (since) {
    query += ' AND e.updated_at > ?';
    params.push(since);
  }
  
  if (startTime) {
    query += ' AND e.end_time >= ?';
    params.push(startTime);
  }
  
  if (endTime) {
    query += ' AND e.start_time <= ?';
    params.push(endTime);
  }
  
  query += ' ORDER BY e.start_time ASC';
  
  const stmt = db.prepare(query);
  const events = stmt.all(...params);
  
  return {
    events: events.map(e => normalizeEvent(e)),
    count: events.length,
    since,
  };
}

export function createEventRepository(db) {
  return {
    async createEvent(calendarId, data) {
      const id = data.id || nanoid();
      const now = Date.now();
      
      const stmt = db.prepare(`
        INSERT INTO calendar_events (
          id, calendar_id, title, description, start_time, end_time,
          all_day, location, recurrence, attendees, alert_minutes, url, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      
      stmt.run(
        id,
        calendarId,
        data.title,
        data.description || null,
        data.startTime,
        data.endTime,
        data.allDay ? 1 : 0,
        data.location || null,
        data.recurrence || null,
        JSON.stringify(data.attendees || []),
        data.alertMinutes ?? null,
        data.url || null,
        now,
        now
      );
      
      return getEvent(db, id);
    },
    
    async getEvent(id) {
      return getEvent(db, id);
    },
    
    async listEvents(calendarId, options = {}) {
      return listEvents(db, calendarId, options);
    },
    
      async listEventsByUser(userId, { includeDeleted = false, since = null, startTime = null, endTime = null } = {}) {
        // Get calendar events
        let query = `
          SELECT e.*, c.user_id 
          FROM calendar_events e
          JOIN calendars c ON e.calendar_id = c.id
          WHERE c.user_id = ?
        `;
        const params = [userId];
        
        if (!includeDeleted) {
          query += ' AND e.deleted_at IS NULL';
        }
        
        if (since) {
          query += ' AND e.updated_at > ?';
          params.push(since);
        }
        
        if (startTime) {
          query += ' AND e.end_time >= ?';
          params.push(startTime);
        }
        
        if (endTime) {
          query += ' AND e.start_time <= ?';
          params.push(endTime);
        }
        
        query += ' ORDER BY e.start_time ASC';
        
        const stmt = db.prepare(query);
        const events = stmt.all(...params);
        
        // Get tasks calendar
        const tasksCalStmt = db.prepare(`
          SELECT id FROM calendars 
          WHERE user_id = ? AND type = 'tasks' AND deleted_at IS NULL
        `);
        const tasksCal = tasksCalStmt.get(userId);
        
        // Get tasks with due dates or reminders
        let tasks = [];
        if (tasksCal) {
          let taskQuery = `
            SELECT DISTINCT t.id, t.title, t.due_at, t.due_has_time, t.is_done
            FROM tasks t
            LEFT JOIN task_list_shares tls ON t.list_id = tls.list_id
            LEFT JOIN task_lists tl ON t.list_id = tl.id
            WHERE (
              t.user_id = ? 
              OR tl.user_id = ? 
              OR tls.shared_with_user_id = ?
            )
            AND t.deleted_at IS NULL
          `;
          const taskParams = [userId, userId, userId];
        
        // Only include tasks with due dates or reminders
        taskQuery += ' AND (t.due_at IS NOT NULL OR t.remind_at IS NOT NULL)';
        
        if (since) {
          taskQuery += ' AND t.updated_at > ?';
          taskParams.push(since);
        }
        
        if (startTime) {
          taskQuery += ' AND t.due_at >= ?';
          taskParams.push(startTime);
        }
        
        if (endTime) {
          taskQuery += ' AND t.due_at <= ?';
          taskParams.push(endTime);
        }
        
        taskQuery += ' ORDER BY t.due_at ASC';
        
        const tasksStmt = db.prepare(taskQuery);
        const taskRows = tasksStmt.all(...taskParams);
        
        // Convert tasks to event format
        tasks = taskRows.map(t => ({
          id: `task-${t.id}`,
          calendarId: tasksCal.id,
          userId: userId,
          title: t.title,
          description: null,
          startTime: t.due_at || Date.now(),
          endTime: (t.due_at || Date.now()) + 3600000, // Default 1 hour duration
          allDay: !t.due_has_time,
          location: null,
          recurrence: null,
          attendees: [],
          createdAt: t.due_at,
          updatedAt: t.due_at,
          deletedAt: null,
          version: 1,
          isTask: true,
          isDone: t.is_done === 1,
        }));
      }
      
      // Normalize events
      const normalizedEvents = events.map(e => normalizeEvent(e));
      
      // Combine events and tasks
      const allItems = [...normalizedEvents, ...tasks];
      allItems.sort((a, b) => a.startTime - b.startTime);
      
      return {
        events: allItems,
        count: allItems.length,
        since,
      };
    },
    
    async updateEvent(id, data) {
      const now = Date.now();
      
      const stmt = db.prepare(`
        UPDATE calendar_events SET
          title = COALESCE(?, title),
          description = CASE WHEN ? THEN ? ELSE description END,
          start_time = COALESCE(?, start_time),
          end_time = COALESCE(?, end_time),
          all_day = COALESCE(?, all_day),
          location = CASE WHEN ? THEN ? ELSE location END,
          recurrence = CASE WHEN ? THEN ? ELSE recurrence END,
          attendees = COALESCE(?, attendees),
          alert_minutes = CASE WHEN ? THEN ? ELSE alert_minutes END,
          url = CASE WHEN ? THEN ? ELSE url END,
          updated_at = ?,
          version = version + 1
        WHERE id = ? AND deleted_at IS NULL
      `);
      
      // Nullable fields are set when sent, null included, so a field can be cleared (COALESCE keeps the old value on null).
      const sent = (key) => (data[key] !== undefined ? 1 : 0);
      stmt.run(
        data.title ?? null,
        sent('description'),
        data.description || null,
        data.startTime ?? null,
        data.endTime ?? null,
        data.allDay !== undefined ? (data.allDay ? 1 : 0) : null,
        sent('location'),
        data.location || null,
        sent('recurrence'),
        data.recurrence || null,
        data.attendees ? JSON.stringify(data.attendees) : null,
        sent('alertMinutes'),
        data.alertMinutes ?? null,
        sent('url'),
        data.url || null,
        now,
        id
      );
      
      return getEvent(db, id);
    },
    
    async deleteEvent(id) {
      const now = Date.now();
      const stmt = db.prepare(`
        UPDATE calendar_events SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `);
      stmt.run(now, now, id);
      
      return getEvent(db, id);
    },
    
    // Delete all events for a calendar (for sync purposes)
    async deleteEventsByCalendar(calendarId) {
      const stmt = db.prepare(`
        DELETE FROM calendar_events
        WHERE calendar_id = ?
      `);
      stmt.run(calendarId);
      
      return [];
    },
  };
}
