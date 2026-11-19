export const MIGRATIONS = [
  {
    id: 1,
    name: "create_base_tables",
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_notes_user_deleted ON notes(user_id, deleted_at);

      CREATE TABLE IF NOT EXISTS task_lists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        sort_order INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_lists_user_updated ON task_lists(user_id, updated_at);

      CREATE TABLE IF NOT EXISTS task_sections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        list_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (list_id) REFERENCES task_lists(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_sections_user_updated ON task_sections(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_sections_list_sort ON task_sections(list_id, sort_order);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        list_id TEXT NOT NULL,
        parent_id TEXT,
        section_id TEXT,
        title TEXT NOT NULL,
        notes TEXT,
        is_done INTEGER NOT NULL DEFAULT 0,
        due_at INTEGER,
        remind_at INTEGER,
        priority INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        sort_order REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (list_id) REFERENCES task_lists(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (section_id) REFERENCES task_sections(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user_updated ON tasks(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_list_sort ON tasks(list_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

      CREATE TABLE IF NOT EXISTS checkpoints (
        device_id TEXT PRIMARY KEY,
        last_pull INTEGER NOT NULL,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: 2,
    name: "add_updated_by_columns",
    up: `
      ALTER TABLE notes ADD COLUMN updated_by TEXT;
      ALTER TABLE task_lists ADD COLUMN updated_by TEXT;
      ALTER TABLE task_sections ADD COLUMN updated_by TEXT;
      ALTER TABLE tasks ADD COLUMN updated_by TEXT;
    `,
  },
  {
    id: 3,
    name: "add_user_profile_fields",
    up: `
      ALTER TABLE users ADD COLUMN display_name TEXT;
      ALTER TABLE users ADD COLUMN avatar_blob BLOB;
      ALTER TABLE users ADD COLUMN avatar_mime TEXT;
      ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER;
    `,
  },
  {
    id: 4,
    name: "add_note_folder_column",
    up: `
      ALTER TABLE notes ADD COLUMN folder TEXT;
    `,
  },
  {
    id: 6,
    name: "add_task_notification_system",
    up: `
      -- Add notification preferences to users table
      ALTER TABLE users ADD COLUMN notification_preferences TEXT NOT NULL DEFAULT '{"taskReminders": true, "taskDueDates": true, "taskAssigned": true, "quietHoursStart": null, "quietHoursEnd": null}';

      -- Create task notifications table
      CREATE TABLE IF NOT EXISTS task_notifications (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('reminder', 'due_date', 'assigned', 'completed')),
        scheduled_at INTEGER NOT NULL,
        sent_at INTEGER,
        is_read INTEGER NOT NULL DEFAULT 0,
        payload TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_notifications_user_scheduled ON task_notifications(user_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_task_notifications_task ON task_notifications(task_id);

      -- Add task sharing table
      CREATE TABLE IF NOT EXISTS task_shares (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        shared_by_user_id TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_shares_task ON task_shares(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_shares_with_user ON task_shares(shared_with_user_id);

      -- Add task attachments table
      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('image', 'file', 'location')),
        name TEXT,
        url TEXT,
        file_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        location_lat REAL,
        location_lng REAL,
        location_name TEXT,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

      -- Add location columns to tasks table
      ALTER TABLE tasks ADD COLUMN location_name TEXT;
      ALTER TABLE tasks ADD COLUMN location_lat REAL;
      ALTER TABLE tasks ADD COLUMN location_lng REAL;

      -- Add shared_with column to tasks for quick lookups
      ALTER TABLE tasks ADD COLUMN shared_with TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    id: 7,
    name: "add_notes_sort_order",
    up: `
      ALTER TABLE notes ADD COLUMN sort_order REAL;
      -- Create index for efficient sorting
      CREATE INDEX IF NOT EXISTS idx_notes_user_sort ON notes(user_id, sort_order);
    `,
  },
  {
    id: 8,
    name: "add_s3_avatar_url",
    up: `
      -- SQLite doesn't support IF NOT EXISTS with ALTER TABLE
      -- This migration will be handled gracefully by the error handler in index.js
      ALTER TABLE users ADD COLUMN avatar_url TEXT;
    `,
  },
  {
    id: 9,
    name: "add_sharing_tables",
    up: `
      -- Task List Shares table
      CREATE TABLE IF NOT EXISTS task_list_shares (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL,
        shared_by_user_id TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (list_id) REFERENCES task_lists(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_list_shares_list ON task_list_shares(list_id);
      CREATE INDEX IF NOT EXISTS idx_task_list_shares_with_user ON task_list_shares(shared_with_user_id);

      -- Note Shares table
      CREATE TABLE IF NOT EXISTS note_shares (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        shared_by_user_id TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_note_shares_note ON note_shares(note_id);
      CREATE INDEX IF NOT EXISTS idx_note_shares_with_user ON note_shares(shared_with_user_id);

      -- Shareable Links table for public sharing
      CREATE TABLE IF NOT EXISTS shareable_links (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('note', 'task_list')),
        resource_id TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_by_user_id TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_shareable_links_slug ON shareable_links(slug);
      CREATE INDEX IF NOT EXISTS idx_shareable_links_resource ON shareable_links(resource_type, resource_id);

      -- Add shared_with columns if they don't exist
      ALTER TABLE task_lists ADD COLUMN shared_with TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE notes ADD COLUMN shared_with TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    id: 10,
    name: "add_tasklist_folders",
    up: `
      -- Create task list folders table
      CREATE TABLE IF NOT EXISTS tasklist_folders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        sort_order INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasklist_folders_user_updated ON tasklist_folders(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_tasklist_folders_user_deleted ON tasklist_folders(user_id, deleted_at);

      -- Add folder_id column to task_lists
      ALTER TABLE task_lists ADD COLUMN folder_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_task_lists_folder ON task_lists(folder_id);
    `,
  },
  {
    id: 11,
    name: "add_calendar_system",
    up: `
      -- Create calendars table
      CREATE TABLE IF NOT EXISTS calendars (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#007AFF',
        type TEXT NOT NULL CHECK (type IN ('internal', 'caldav', 'tasks')),
        url TEXT,
        username TEXT,
        password TEXT, -- Encrypted
        last_sync INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_calendars_user_active ON calendars(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_calendars_user_updated ON calendars(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_calendars_user_deleted ON calendars(user_id, deleted_at);

      -- Create calendar events table
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_time INTEGER NOT NULL, -- Unix timestamp in milliseconds
        end_time INTEGER NOT NULL, -- Unix timestamp in milliseconds
        all_day INTEGER NOT NULL DEFAULT 0,
        location TEXT,
        recurrence TEXT, -- rrule string for recurring events
        attendees TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON calendar_events(calendar_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_time_range ON calendar_events(start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_updated ON calendar_events(updated_at);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted ON calendar_events(deleted_at);
    `,
  },
  {
    id: 12,
    name: "add_push_and_read_status",
    up: `
      -- Create push subscriptions table
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

      -- Add is_read column to share tables
      -- Using ALTER TABLE one by one as SQLite limitation
      ALTER TABLE note_shares ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE task_list_shares ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE task_shares ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 13,
    name: "fix_missing_notification_tables",
    up: `
      CREATE TABLE IF NOT EXISTS task_notifications (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('reminder', 'due_date', 'assigned', 'completed')),
        scheduled_at INTEGER NOT NULL,
        sent_at INTEGER,
        is_read INTEGER NOT NULL DEFAULT 0,
        payload TEXT,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_notifications_user_scheduled ON task_notifications(user_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_task_notifications_task ON task_notifications(task_id);

      CREATE TABLE IF NOT EXISTS task_shares (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        shared_by_user_id TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_shares_task ON task_shares(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_shares_with_user ON task_shares(shared_with_user_id);

      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('image', 'file', 'location')),
        name TEXT,
        url TEXT,
        file_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        location_lat REAL,
        location_lng REAL,
        location_name TEXT,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
    `,
  },
  {
    id: 14,
    name: "fix_missing_task_columns_location",
    up: `
      ALTER TABLE tasks ADD COLUMN location_name TEXT;
      ALTER TABLE tasks ADD COLUMN location_lat REAL;
      ALTER TABLE tasks ADD COLUMN location_lng REAL;
    `,
  },
  {
    id: 15,
    name: "fix_missing_task_columns_shared",
    up: `
      ALTER TABLE tasks ADD COLUMN shared_with TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    id: 16,
    name: "add_deleted_at_to_task_notifications",
    up: `
      ALTER TABLE task_notifications ADD COLUMN deleted_at INTEGER;
    `,
  },
  {
    id: 17,
    name: "add_overdue_notification_type",
    up: `
      -- SQLite doesn't support modifying CHECK constraints
      -- We need to recreate the table with the updated constraint
      
      -- Create temporary table with new constraint
      CREATE TABLE task_notifications_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('reminder', 'due_date', 'assigned', 'completed', 'overdue')),
        scheduled_at INTEGER NOT NULL,
        sent_at INTEGER,
        is_read INTEGER NOT NULL DEFAULT 0,
        payload TEXT,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      
      -- Copy data from old table
      INSERT INTO task_notifications_new 
      SELECT * FROM task_notifications;
      
      -- Drop old table
      DROP TABLE task_notifications;
      
      -- Rename new table
      ALTER TABLE task_notifications_new RENAME TO task_notifications;
      
      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_task_notifications_user_scheduled ON task_notifications(user_id, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_task_notifications_task ON task_notifications(task_id);
    `,
  },
  {
    id: 18,
    name: "add_task_due_has_time",
    up: `
      ALTER TABLE tasks ADD COLUMN due_has_time INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    id: 19,
    name: "add_task_flagged",
    up: `
      ALTER TABLE tasks ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 20,
    name: "add_task_recurrence",
    up: `
      ALTER TABLE tasks ADD COLUMN recurrence TEXT;
    `,
  },
  {
    id: 21,
    name: "add_task_url",
    up: `
      ALTER TABLE tasks ADD COLUMN url TEXT;
    `,
  },
  {
    id: 22,
    name: "add_task_section_icon",
    up: `
      ALTER TABLE task_sections ADD COLUMN icon TEXT;
    `,
  },
  {
    id: 23,
    name: "add_task_section_color",
    up: `
      ALTER TABLE task_sections ADD COLUMN color TEXT;
    `,
  },
  {
    id: 24,
    name: "add_event_alert_minutes",
    up: `
      ALTER TABLE calendar_events ADD COLUMN alert_minutes INTEGER;
    `,
  },
  {
    id: 25,
    name: "add_event_url",
    up: `
      ALTER TABLE calendar_events ADD COLUMN url TEXT;
    `,
  },
  {
    id: 26,
    name: "add_user_avatar_icon",
    up: `
      ALTER TABLE users ADD COLUMN avatar_icon TEXT;
    `,
  },
  {
    id: 27,
    name: "add_user_avatar_color",
    up: `
      ALTER TABLE users ADD COLUMN avatar_color TEXT;
    `,
  },
  {
    id: 28,
    name: "add_calendar_sync_kind",
    up: `
      ALTER TABLE calendars ADD COLUMN sync_kind TEXT;
    `,
  },
  {
    id: 29,
    name: "add_calendar_sync_error",
    up: `
      ALTER TABLE calendars ADD COLUMN sync_error TEXT;
    `,
  },
  {
    id: 30,
    name: "add_event_external_id",
    up: `
      ALTER TABLE calendar_events ADD COLUMN external_id TEXT;
    `,
  },
  {
    id: 31,
    name: "add_task_list_uncategorized_name",
    up: `
      ALTER TABLE task_lists ADD COLUMN uncategorized_name TEXT;
    `,
  },
  {
    id: 32,
    name: "add_task_list_grocery_mode",
    up: `
      ALTER TABLE task_lists ADD COLUMN grocery_mode INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 33,
    name: "add_task_list_view_mode",
    up: `
      ALTER TABLE task_lists ADD COLUMN view_mode TEXT;
    `,
  },
  {
    id: 34,
    name: "add_task_assignee",
    up: `
      ALTER TABLE tasks ADD COLUMN assignee_id TEXT;
    `,
  },
  {
    id: 35,
    name: "add_task_completed_at",
    up: `
      ALTER TABLE tasks ADD COLUMN completed_at INTEGER;
      UPDATE tasks SET completed_at = updated_at WHERE is_done = 1 AND completed_at IS NULL;
    `,
  },
  {
    id: 36,
    name: "add_task_notes",
    up: `
      CREATE TABLE IF NOT EXISTS task_notes (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id, created_at);
      -- A task's old single notes field becomes the first note in its thread, by the task's owner.
      INSERT OR IGNORE INTO task_notes (id, task_id, user_id, body, created_at)
        SELECT 'legacy-' || id, id, user_id, notes, COALESCE(updated_at, created_at)
        FROM tasks WHERE notes IS NOT NULL AND TRIM(notes) != '';
    `,
  },
];
