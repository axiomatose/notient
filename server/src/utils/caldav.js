import ical from 'ical-generator';
import icalParser from 'node-ical';
import logger from './logger.js';
import { nanoid } from 'nanoid';

/**
 * Syncs events from a CalDAV server
 * Supports both reading existing calendars and pushing changes (create/edit/delete)
 */
export class CalDAVSync {
  constructor(repos) {
    this.repos = repos;
  }

  /**
   * Fetch and parse events from a CalDAV calendar
   */
  async fetchCalendar(calendar) {
    try {
      if (!calendar.url) {
        throw new Error('CalDAV URL is required');
      }

      const password = calendar.password || null;

      const response = await this._fetchiCal(calendar.url, {
        username: calendar.username,
        password: password,
        calendarName: calendar.name
      });
      
      logger.debug(`[CalDAV] Fetched ${response.length} chars of iCal data from ${calendar.name}`);
      
      const events = this._parseiCal(response, calendar.id);
      logger.info(`[CalDAV] Successfully parsed ${events.length} events from ${calendar.name}`);
      
      return events;
    } catch (error) {
      logger.error('[CalDAV] Error fetching calendar:', error);
      throw error;
    }
  }

  /**
   * Sync a specific calendar and update the database
   */
  async syncCalendar(calendarId, userId) {
    const calendar = await this.repos.calendars.getCalendar(calendarId);
    if (!calendar || calendar.userId !== userId) {
      throw new Error('Calendar not found or access denied');
    }

    if (calendar.type !== 'caldav') {
      throw new Error('Only CalDAV calendars can be synced');
    }

    const fetchedEvents = await this.fetchCalendar(calendar);
    
    // Delete existing events for this calendar
    await this.repos.events.deleteEventsByCalendar(calendarId);
    
    // Create new events
    const results = [];
    for (const eventData of fetchedEvents) {
      const event = await this.repos.events.createEvent(calendarId, eventData);
      results.push(event);
    }

    // Update last sync time
    await this.repos.calendars.updateCalendar(calendarId, {
      lastSync: Date.now()
    });

    return results;
  }

  /**
   * Pushes a local event to the remote CalDAV server
   */
  async pushEvent(calendarId, userId, event, isNew = false) {
    const calendar = await this.repos.calendars.getCalendar(calendarId);
    if (!calendar || calendar.userId !== userId) {
      throw new Error('Calendar not found or access denied');
    }

    if (calendar.type !== 'caldav') return;

    const password = calendar.password || null;

    const eventId = isNew ? (event.id || nanoid()) : event.id;
    // For CalDAV, we push to a specific URL: collection_url + uid + .ics
    let url = calendar.url;
    if (!url.endsWith('/')) url += '/';
    url += `${eventId}.ics`;

    const calendarObj = ical({ name: calendar.name });
    const iEvent = calendarObj.createEvent({
      id: eventId,
      start: new Date(event.startTime),
      end: new Date(event.endTime),
      summary: event.title,
      description: event.description || '',
      location: event.location || '',
      allDay: !!event.allDay,
    });

    if (event.recurrence) {
      iEvent.repeating(event.recurrence);
    }

    const iCalString = calendarObj.toString();

    const auth = Buffer.from(`${calendar.username}:${password}`).toString('base64');
    
    logger.debug(`[CalDAV] Pushing to: PUT ${url} (User: ${calendar.username})`);

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Authorization': `Basic ${auth}`,
        'If-None-Match': isNew ? '*' : undefined,
      },
      body: iCalString
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      const text = await response.text();
      logger.error(`[CalDAV] Push failed: ${response.status} ${text}`);
      throw new Error(`Failed to push to CalDAV: ${response.status}`);
    }

    logger.info(`[CalDAV] Successfully pushed event ${eventId} to ${calendar.name}`);
    return eventId;
  }

  /**
   * Deletes an event from the remote CalDAV server
   */
  async deleteRemoteEvent(calendarId, userId, eventId) {
    const calendar = await this.repos.calendars.getCalendar(calendarId);
    if (!calendar || calendar.userId !== userId) return;
    if (calendar.type !== 'caldav') return;

    const password = calendar.password || null;

    let url = calendar.url;
    if (!url.endsWith('/')) url += '/';
    url += `${eventId}.ics`;

    const auth = Buffer.from(`${calendar.username}:${password}`).toString('base64');
    
    logger.debug(`[CalDAV] Deleting: DELETE ${url} (User: ${calendar.username})`);

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${auth}`,
      }
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      logger.error(`[CalDAV] Delete failed: ${response.status} ${text}`);
      throw new Error(`Failed to delete from CalDAV: ${response.status}`);
    }

    logger.info(`[CalDAV] Successfully deleted event ${eventId} from ${calendar.name}`);
  }

  /**
   * Fetch iCal data from URL
   */
  async _fetchiCal(url, credentials) {
    // Some iCal URLs might have spaces or special chars if copy-pasted incorrectly
    const cleanUrl = url.trim();
    
    logger.debug(`[CalDAV] Requesting: GET ${cleanUrl} (User: ${credentials.username || 'none'})`);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/calendar, text/plain, */*',
      'Cache-Control': 'no-cache'
    };
    
    if (credentials.username && credentials.password) {
      const username = credentials.username.trim();
      // Google App Passwords are often shown with spaces (e.g. "abcd efgh ijkl mnop")
      // but they must be sent without any spaces.
      let password = credentials.password.trim();
      if (password.length === 19 && password.split(' ').length === 4) {
        // Detect 19-char password with spaces
        password = password.replace(/\s/g, '');
      } else {
        // General cleanup for extra safety
        password = password.replace(/\s/g, '');
      }
      
      logger.debug(`[CalDAV] Sending Basic Auth for ${username} (Sanitized Password length: ${password.length})`);
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    
    const response = await fetch(cleanUrl, { headers });
    
    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`[CalDAV] Fetch failed (${response.status}):`, errorBody);
      
      if (response.status === 401 && errorBody.includes('OAuth 2') && cleanUrl.includes('googleusercontent.com')) {
        logger.warn('GOOGLE AUTH HINT: The URL you are using usually REQUIRES OAuth2.');
      }
      
      throw new Error(`Failed to fetch iCal: ${response.status} ${response.statusText}`);
    }
    
    return await response.text();
  }

  /**
   * Parse iCal data into event objects
   */
  _parseiCal(iCalData, calendarId) {
    try {
      // Aggressive UNTIL sanitization for RRULEs
      let sanitizedData = iCalData.replace(/\bUNTIL=([^; \n\r]+)/gi, (match, val) => {
        if (val.includes('T') && val.includes('Z')) return match;
        const cleanVal = val.split(':').pop().replace(/[^0-9T]/gi, '');
        if (cleanVal.includes('T')) {
          return `UNTIL=${cleanVal}Z`;
        } else {
          return `UNTIL=${cleanVal}T235959Z`;
        }
      });

      const parsed = icalParser.parseICS(sanitizedData);
      const events = [];
      
      for (const [uid, vevent] of Object.entries(parsed)) {
        if (vevent.type !== 'VEVENT') continue;
        
        const startDate = vevent.start;
        const endDate = vevent.end;
        
        if (!startDate) continue;

        let startTime = startDate instanceof Date ? startDate.getTime() : new Date(startDate).getTime();
        let endTime;
        
        if (endDate) {
          endTime = endDate instanceof Date ? endDate.getTime() : new Date(endDate).getTime();
        } else {
          endTime = startTime + 3600000;
        }

        events.push({
          id: uid,
          title: vevent.summary || 'Untitled',
          description: vevent.description || null,
          startTime: startTime,
          endTime: endTime,
          allDay: vevent.datetype === 'date' ? 1 : 0,
          location: vevent.location || null,
          recurrence: vevent.rrule ? this._rruleToString(vevent.rrule) : null,
          attendees: vevent.attendee ? 
            (Array.isArray(vevent.attendee) ? vevent.attendee : [vevent.attendee])
              .map(a => {
                if (typeof a === 'string') return a;
                return a.val || (a.params ? a.params.CN : null) || null;
              }).filter(Boolean) : [],
        });
      }
      
      return events;
    } catch (error) {
      logger.error('[CalDAV] Parsing error occurred:', error);
      return [];
    }
  }

  _rruleToString(rrule) {
    if (typeof rrule === 'string') return rrule;
    if (rrule && rrule.toString) return rrule.toString();
    return null;
  }
}
