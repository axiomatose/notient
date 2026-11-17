import { z } from 'zod';
import express from 'express';
import { discoverCaldav, syncCalendarById, normalizeUrl, SyncError } from '../lib/calendarSync.js';

// Validation schemas
const createCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  color: z.string().optional(),
  type: z.enum(['internal', 'caldav', 'tasks']),
  url: z.string().url().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const subscribeSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(255).optional(),
  color: z.string().optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(1000).optional(),
});

const caldavAccountSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1000),
});

const caldavConnectSchema = caldavAccountSchema.extend({
  calendars: z.array(z.object({ url: z.string().min(1).max(2000), name: z.string().max(255), color: z.string().optional() })).min(1).max(50),
});

const PALETTE = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA', '#FFCC00', '#8E8E93'];

const updateCalendarSchema = createCalendarSchema.partial();

const createEventSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  allDay: z.boolean().optional().default(false),
  location: z.string().nullable().optional(),
  recurrence: z.string().nullable().optional(),
  // Minutes before the start that an alert fires; null for none.
  alertMinutes: z.number().int().min(0).max(525600).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  attendees: z.array(z.string().email()).optional(),
});

const updateEventSchema = createEventSchema.partial();

export function createCalendarsRouter({ repos, requireAuth, db }) {
  const router = express.Router();
  
  router.use(requireAuth);

  const refuse = (res, error) => res.status(400).json({ error: 'sync_failed', message: error });
  const failure = (res, next, e) => (e instanceof SyncError || e?.name === 'ZodError' ? refuse(res, e instanceof SyncError ? e.message : 'Check the address and try again.') : next(e));

  // Subscribe to an ICS link (iCloud public calendar, Google secret iCal address, Outlook, any .ics feed).
  router.post('/subscribe', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const data = subscribeSchema.parse(req.body);
      const url = normalizeUrl(data.url);
      const existing = (await repos.calendars.listCalendars(userId)).calendars;
      const calendar = await repos.calendars.createCalendar(userId, {
        name: data.name || new URL(url).hostname,
        color: data.color || PALETTE[existing.length % PALETTE.length],
        type: 'caldav',
        syncKind: 'ics',
        url,
        username: data.username || undefined,
        password: data.password || undefined,
        sortOrder: existing.length,
      });
      const result = await syncCalendarById(repos, calendar.id);
      if (!result.ok) {
        await repos.calendars.deleteCalendar(calendar.id);
        return refuse(res, result.error);
      }
      res.status(201).json({ calendar: await repos.calendars.getCalendar(calendar.id), count: result.count });
    } catch (e) {
      failure(res, next, e);
    }
  });

  // List the calendars of a CalDAV account (iCloud, Fastmail, Nextcloud, Synology, Radicale, ...).
  router.post('/caldav/discover', async (req, res, next) => {
    try {
      const data = caldavAccountSchema.parse(req.body);
      const found = await discoverCaldav(data.url, { username: data.username, password: data.password });
      res.json({ calendars: found });
    } catch (e) {
      failure(res, next, e);
    }
  });

  // Subscribe to the chosen calendars of a CalDAV account: one local calendar each.
  router.post('/caldav/connect', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const data = caldavConnectSchema.parse(req.body);
      const existing = (await repos.calendars.listCalendars(userId)).calendars;
      const made = [];
      let failed = '';
      for (const [i, c] of data.calendars.entries()) {
        const calendar = await repos.calendars.createCalendar(userId, {
          name: c.name || 'Calendar',
          color: c.color || PALETTE[(existing.length + i) % PALETTE.length],
          type: 'caldav',
          syncKind: 'caldav',
          url: normalizeUrl(c.url),
          username: data.username,
          password: data.password,
          sortOrder: existing.length + i,
        });
        const result = await syncCalendarById(repos, calendar.id);
        if (!result.ok) {
          failed = result.error;
          await repos.calendars.deleteCalendar(calendar.id);
        } else {
          made.push(calendar.id);
        }
      }
      if (!made.length) return refuse(res, failed || 'No calendar could be added.');
      res.status(201).json({ added: made.length, calendars: made });
    } catch (e) {
      failure(res, next, e);
    }
  });
  
  
  // List calendars
  router.get('/', async (req, res, next) => {
    try {
      const { since } = req.query;
      const { userId } = req.auth;
      
      const result = await repos.calendars.listCalendars(userId, {
        since: since ? parseInt(since) : null,
      });
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
  
  // Get single calendar
  router.get('/:id', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const calendar = await repos.calendars.getCalendar(req.params.id);
      
      if (!calendar) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      
      if (calendar.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      res.json({ calendar });
    } catch (error) {
      next(error);
    }
  });
  
  // Create calendar
  router.post('/', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const data = createCalendarSchema.parse(req.body);
      
      // Only allow creating internal or caldav calendars (not tasks)
      if (data.type === 'tasks') {
        return res.status(400).json({ error: 'Cannot create tasks calendar' });
      }
      
      const calendar = await repos.calendars.createCalendar(userId, data);
      res.status(201).json({ calendar });
    } catch (error) {
      next(error);
    }
  });
  
  // Update calendar
  router.patch('/:id', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const data = updateCalendarSchema.parse(req.body);
      
      const existing = await repos.calendars.getCalendar(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      
      if (existing.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Don't allow changing type to/from tasks
      if (data.type && data.type !== existing.type) {
        return res.status(400).json({ error: 'Cannot change calendar type' });
      }
      
      const calendar = await repos.calendars.updateCalendar(req.params.id, data);
      res.json({ calendar });
    } catch (error) {
      next(error);
    }
  });
  
  // Delete calendar
  router.delete('/:id', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      
      const existing = await repos.calendars.getCalendar(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      
      if (existing.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Don't allow deleting default calendars
      if (existing.type === 'tasks') {
        return res.status(400).json({ error: 'Cannot delete tasks calendar' });
      }
      
      const calendar = await repos.calendars.deleteCalendar(req.params.id);
      
      res.json({ calendar });
    } catch (error) {
      next(error);
    }
  });
  
  // Get all events for user (across all active calendars)
  router.get('/user/events', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const { since, startTime, endTime } = req.query;
      
      const result = await repos.events.listEventsByUser(userId, {
        since: since ? parseInt(since) : null,
        startTime: startTime ? parseInt(startTime) : null,
        endTime: endTime ? parseInt(endTime) : null,
      });
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
  
  // List events for a calendar
  router.get('/:calendarId/events', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const { since, startTime, endTime } = req.query;
      
      const calendar = await repos.calendars.getCalendar(req.params.calendarId);
      if (!calendar) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      
      if (calendar.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const result = await repos.events.listEvents(req.params.calendarId, {
        since: since ? parseInt(since) : null,
        startTime: startTime ? parseInt(startTime) : null,
        endTime: endTime ? parseInt(endTime) : null,
      });
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
  
  // Create event
  router.post('/:calendarId/events', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const data = createEventSchema.parse(req.body);
      
      const calendar = await repos.calendars.getCalendar(req.params.calendarId);
      if (!calendar) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      
      if (calendar.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      if (calendar.readOnly) {
        return res.status(400).json({ error: 'read_only', message: 'This calendar is subscribed, so it is read-only.' });
      }

      // Don't allow creating events in tasks calendar
      if (calendar.type === 'tasks') {
        return res.status(400).json({ error: 'Cannot create events in tasks calendar' });
      }
      
      const event = await repos.events.createEvent(req.params.calendarId, data);
      
      // If it's a CalDAV calendar, push it
      if (calendar.type === 'caldav') {
        try {
          const { CalDAVSync } = await import('../utils/caldav.js');
          const sync = new CalDAVSync(repos);
          await sync.pushEvent(calendar.id, userId, event, true);
        } catch (error) {
          console.error('[CalDAV] Push failed on create:', error);
          // We don't fail the request, but we could log it
        }
      }
      
      res.status(201).json({ event });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      next(error);
    }
  });
  
  // Update event
  router.patch('/events/:eventId', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const data = updateEventSchema.parse(req.body);
      
      const event = await repos.events.getEvent(req.params.eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      if (event.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const calendar = await repos.calendars.getCalendar(event.calendarId);
      if (calendar?.readOnly) {
        return res.status(400).json({ error: 'read_only', message: 'This calendar is subscribed, so it is read-only.' });
      }
      if (calendar?.type === 'tasks') {
        return res.status(400).json({ error: 'Cannot modify tasks calendar events' });
      }
      
      const updatedEvent = await repos.events.updateEvent(req.params.eventId, data);
      
      // If it's a CalDAV calendar, push it
      if (calendar?.type === 'caldav') {
        try {
          const { CalDAVSync } = await import('../utils/caldav.js');
          const sync = new CalDAVSync(repos);
          await sync.pushEvent(calendar.id, userId, updatedEvent, false);
        } catch (error) {
          console.error('[CalDAV] Push failed on update:', error);
        }
      }
      
      res.json({ event: updatedEvent });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      next(error);
    }
  });
  
  // Delete event
  router.delete('/events/:eventId', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      
      const event = await repos.events.getEvent(req.params.eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      if (event.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const calendar = await repos.calendars.getCalendar(event.calendarId);
      if (calendar?.readOnly) {
        return res.status(400).json({ error: 'read_only', message: 'This calendar is subscribed, so it is read-only.' });
      }
      if (calendar?.type === 'tasks') {
        return res.status(400).json({ error: 'Cannot delete tasks calendar events' });
      }
      
      const deletedEvent = await repos.events.deleteEvent(req.params.eventId);
      
      if (calendar?.type === 'caldav') {
        try {
          const { CalDAVSync } = await import('../utils/caldav.js');
          const sync = new CalDAVSync(repos);
          await sync.deleteRemoteEvent(calendar.id, userId, req.params.eventId);
        } catch (error) {
          console.error('[CalDAV] Delete failed on remote:', error);
        }
      }
      
      res.json({ event: deletedEvent });
    } catch (error) {
      next(error);
    }
  });
  
  // Sync calendar
  router.post('/:id/sync', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      const { id } = req.params;
      
      const calendar = await repos.calendars.getCalendar(id);
      if (!calendar) {
        return res.status(404).json({ error: 'Calendar not found' });
      }
      
      if (calendar.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      if (calendar.syncKind) {
        const result = await syncCalendarById(repos, id);
        if (!result.ok) return refuse(res, result.error);
        return res.json({ calendar: await repos.calendars.getCalendar(id), count: result.count });
      }

      if (calendar.type !== 'caldav') {
        return res.status(400).json({ error: 'Only CalDAV calendars can be synced' });
      }
      
      const { CalDAVSync } = await import('../utils/caldav.js');
      const sync = new CalDAVSync(repos);
      
      const events = await sync.syncCalendar(id, userId);
      
      res.json({ 
        success: true, 
        eventCount: events.length,
        lastSync: Date.now()
      });
    } catch (error) {
      console.error('Sync failed:', error);
      res.status(500).json({ error: 'Sync failed', message: error.message });
    }
  });

  // Ensure default calendars exist for user
  router.post('/ensure-defaults', async (req, res, next) => {
    try {
      const { userId } = req.auth;
      
      await repos.calendars.setDefaultCalendars(userId);
      
      const calendars = await repos.calendars.listCalendars(userId);
      
      res.json({ calendars: calendars.calendars });
    } catch (error) {
      next(error);
    }
  });
  
  return router;
}
