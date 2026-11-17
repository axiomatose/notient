import {
  stringifyJsonArray,
  parseJsonArray,
  booleanToInteger,
  integerToBoolean,
  coerceNullableNumber,
  coerceNullableString,
} from "./utils.js";
import { normalizeRecurrence } from "../lib/recurrence.js";

const TASK_COLUMNS = `
  id, user_id, list_id, parent_id, section_id, title, notes, is_done,
  due_at, due_has_time, remind_at, priority, tags, sort_order,
  flagged, recurrence, url, assignee_id, completed_at,
  created_at, updated_at, deleted_at, version, updated_by
`;

const FIELD_MAP = new Map([
  ["title", "title"],
  ["notes", "notes"],
  ["list_id", "list_id"],
  ["listId", "list_id"],
  ["parent_id", "parent_id"],
  ["parentId", "parent_id"],
  ["section_id", "section_id"],
  ["sectionId", "section_id"],
  ["is_done", "is_done"],
  ["isDone", "is_done"],
  ["due_at", "due_at"],
  ["dueAt", "due_at"],
  ["due_has_time", "due_has_time"],
  ["dueHasTime", "due_has_time"],
  ["remind_at", "remind_at"],
  ["remindAt", "remind_at"],
  ["flagged", "flagged"],
  ["recurrence", "recurrence"],
  ["url", "url"],
  ["assigneeId", "assignee_id"],
  ["assignee_id", "assignee_id"],
  ["priority", "priority"],
  ["tags", "tags"],
  ["sort_order", "sort_order"],
  ["sortOrder", "sort_order"],
  ["deleted_at", "deleted_at"],
  ["deletedAt", "deleted_at"],
  ["version", "version"],
  ["updated_at", "updated_at"],
  ["updatedAt", "updated_at"],
]);

function mapRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    listId: row.list_id,
    parentId: coerceNullableString(row.parent_id),
    sectionId: coerceNullableString(row.section_id),
    title: row.title,
    notes: row.notes ?? "",
    isDone: integerToBoolean(row.is_done),
    dueAt: coerceNullableNumber(row.due_at),
    dueHasTime: integerToBoolean(row.due_has_time ?? 1),
    remindAt: coerceNullableNumber(row.remind_at),
    flagged: integerToBoolean(row.flagged ?? 0),
    recurrence: normalizeRecurrence(row.recurrence) ?? "none",
    url: coerceNullableString(row.url),
    assigneeId: coerceNullableString(row.assignee_id),
    completedAt: coerceNullableNumber(row.completed_at),
    priority: coerceNullableNumber(row.priority),
    tags: parseJsonArray(row.tags),
    sortOrder: coerceNullableNumber(row.sort_order),
    // Only set on list rows (listStmt), so other responses omit it.
    subtaskCount:
      row.subtask_count === undefined ? undefined : Number(row.subtask_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: coerceNullableNumber(row.deleted_at),
    version: row.version,
    updatedBy: row.updated_by || null,
  };
}

function normalizeIncoming(payload, { userId, deviceId }) {
  const createdAt =
    typeof payload.createdAt === "number" ? payload.createdAt : Date.now();
  const updatedAt =
    typeof payload.updatedAt === "number" ? payload.updatedAt : createdAt;

  return {
    raw: {
      id: payload.id,
      user_id: userId,
      list_id: payload.listId,
      parent_id: coerceNullableString(payload.parentId),
      section_id: coerceNullableString(payload.sectionId),
      title: payload.title ?? "",
      notes:
        payload.notes !== undefined && payload.notes !== null
          ? String(payload.notes)
          : "",
      is_done: booleanToInteger(Boolean(payload.isDone)),
      due_at: coerceNullableNumber(payload.dueAt),
      due_has_time: booleanToInteger(payload.dueHasTime !== false), // Default to true
      remind_at: coerceNullableNumber(payload.remindAt),
      flagged: booleanToInteger(Boolean(payload.flagged)),
      recurrence: normalizeRecurrence(payload.recurrence),
      url: coerceNullableString(payload.url),
      assignee_id: coerceNullableString(payload.assigneeId),
      completed_at: payload.isDone ? (typeof payload.completedAt === "number" ? payload.completedAt : updatedAt) : null,
      priority: coerceNullableNumber(payload.priority),
      tags: stringifyJsonArray(payload.tags ?? []),
      sort_order: coerceNullableNumber(payload.sortOrder),
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at:
        typeof payload.deletedAt === "number" ? payload.deletedAt : null,
      version:
        typeof payload.version === "number" && payload.version > 0
          ? payload.version
          : 1,
      updated_by: deviceId ?? null,
    },
    changedFields: Array.isArray(payload.changedFields)
      ? payload.changedFields
      : [],
  };
}

function comparePriority(existingRow, incomingRow, incomingDeviceId) {
  if (incomingRow.updated_at > existingRow.updated_at) {
    return 1;
  }
  if (incomingRow.updated_at < existingRow.updated_at) {
    return -1;
  }

  if (incomingRow.version > existingRow.version) {
    return 1;
  }
  if (incomingRow.version < existingRow.version) {
    return -1;
  }

  const existingDevice = existingRow.updated_by || "";
  const incomingDevice = incomingDeviceId || "";

  if (incomingDevice > existingDevice) {
    return 1;
  }
  if (incomingDevice < existingDevice) {
    return -1;
  }

  return 0;
}

export function createTasksRepository(db) {
  const listStmt = db.prepare(`
    SELECT ${TASK_COLUMNS},
      (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = tasks.id AND c.deleted_at IS NULL) AS subtask_count
    FROM tasks
    WHERE user_id = @userId
      AND (@includeDeleted = 1 OR deleted_at IS NULL)
      AND (@listId IS NULL OR list_id = @listId)
      AND ((@parentId IS NULL AND parent_id IS NULL) OR parent_id = @parentId)
    ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC
  `);

      const findByIdStmt = db.prepare(`
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE id = ? AND user_id = ?
  `);

  const findAnyByIdStmt = db.prepare(`
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE id = ?
  `);

      const findByIdOrSharedStmt = db.prepare(`
        SELECT t.id, t.user_id, t.list_id, t.parent_id, t.section_id, t.title, t.notes, t.is_done,
          t.due_at, t.due_has_time, t.remind_at, t.flagged, t.recurrence, t.url, t.priority, t.tags, t.sort_order,
          t.created_at, t.updated_at, t.deleted_at, t.version, t.updated_by,
          tls.permission as list_permission, tls.shared_with_user_id as shared_with_user_id
        FROM tasks t
        LEFT JOIN task_list_shares tls ON t.list_id = tls.list_id
        WHERE t.id = ? 
          AND (t.user_id = ? OR (tls.shared_with_user_id = ? AND tls.permission IN ('edit', 'admin')))
      `);

  const findByIdOnlyStmt = db.prepare(`
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE id = ?
  `);

  const findListByIdStmt = db.prepare(`
    SELECT id FROM task_lists WHERE id = ?
  `);

  const findSectionByIdStmt = db.prepare(`
    SELECT id FROM task_sections WHERE id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO tasks (
      id, user_id, list_id, parent_id, section_id, title, notes, is_done,
      due_at, due_has_time, remind_at, flagged, recurrence, url, assignee_id, completed_at, priority, tags, sort_order,
      created_at, updated_at, deleted_at, version, updated_by
    ) VALUES (
      @id, @user_id, @list_id, @parent_id, @section_id, @title, @notes, @is_done,
      @due_at, @due_has_time, @remind_at, @flagged, @recurrence, @url, @assignee_id, @completed_at, @priority, @tags, @sort_order,
      @created_at, @updated_at, @deleted_at, @version, @updated_by
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE tasks
    SET
      list_id = @list_id,
      parent_id = @parent_id,
      section_id = @section_id,
      title = @title,
      notes = @notes,
      is_done = @is_done,
      due_at = @due_at,
      due_has_time = @due_has_time,
      remind_at = @remind_at,
      flagged = @flagged,
      recurrence = @recurrence,
      url = @url,
      assignee_id = @assignee_id,
      completed_at = @completed_at,
      priority = @priority,
      tags = @tags,
      sort_order = @sort_order,
      updated_at = @updated_at,
      deleted_at = @deleted_at,
      version = @version,
      updated_by = @updated_by
    WHERE id = @id AND user_id = @user_id
  `);

  const listSinceStmt = db.prepare(`
    SELECT ${TASK_COLUMNS}
    FROM tasks
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `);

  return {
    list({ userId, listId = null, parentId = null, includeDeleted = false }) {
      // Get tasks user owns or has access to via shared lists
      const rows = listStmt.all({
        userId,
        listId,
        parentId,
        includeDeleted: includeDeleted ? 1 : 0,
      });
      return rows.map(mapRow);
    },
    listWithAccess({ userId, listId = null, parentId = null, includeDeleted = false }) {
      // Get tasks from shared lists that user has access to
      const stmt = db.prepare(`
        SELECT ${TASK_COLUMNS}
        FROM tasks t
        JOIN task_list_shares tls ON t.list_id = tls.list_id
        WHERE tls.shared_with_user_id = ?
          AND (@includeDeleted = 1 OR t.deleted_at IS NULL)
          AND (@listId IS NULL OR t.list_id = @listId)
          AND ((@parentId IS NULL AND t.parent_id IS NULL) OR t.parent_id = @parentId)
          AND tls.permission IN ('edit', 'admin')
        ORDER BY COALESCE(t.sort_order, 0) ASC, t.updated_at DESC
      `);
      const rows = stmt.all({
        userId,
        listId,
        parentId,
        includeDeleted: includeDeleted ? 1 : 0,
      });
      return rows.map(mapRow);
    },
    findById({ userId, id }) {
      const row = findByIdStmt.get(id, userId);
      return mapRow(row);
    },
    /** A task whoever owns it: callers check access to its list. */
    findAnyById(id) {
      return mapRow(findAnyByIdStmt.get(id));
    },
    create({ userId, data, deviceId }) {
      const normalized = normalizeIncoming(
        {
          ...data,
          createdAt: data.createdAt ?? Date.now(),
          updatedAt: data.updatedAt ?? Date.now(),
          version: data.version ?? 1,
        },
        { userId, deviceId },
      );
      insertStmt.run(normalized.raw);
      return this.findById({ userId, id: normalized.raw.id });
    },
    update({ userId, id, data, deviceId }) {
      const current = findByIdStmt.get(id, userId);
      if (!current) {
        return null;
      }

      const updatedAt = data.updatedAt ?? Date.now();

      const newRow = {
        ...current,
        list_id: data.listId ?? current.list_id,
        parent_id:
          data.parentId !== undefined
            ? coerceNullableString(data.parentId)
            : current.parent_id,
        section_id:
          data.sectionId !== undefined
            ? coerceNullableString(data.sectionId)
            : current.section_id,
        title: data.title ?? current.title,
        notes:
          data.notes !== undefined && data.notes !== null
            ? String(data.notes)
            : current.notes,
        is_done:
          data.isDone !== undefined
            ? booleanToInteger(Boolean(data.isDone))
            : current.is_done,
        due_at:
          data.dueAt !== undefined
            ? coerceNullableNumber(data.dueAt)
            : current.due_at,
        due_has_time:
          data.dueHasTime !== undefined
            ? booleanToInteger(data.dueHasTime)
            : current.due_has_time ?? 1,
        remind_at:
          data.remindAt !== undefined
            ? coerceNullableNumber(data.remindAt)
            : current.remind_at,
        flagged:
          data.flagged !== undefined
            ? booleanToInteger(Boolean(data.flagged))
            : current.flagged ?? 0,
        recurrence:
          data.recurrence !== undefined
            ? normalizeRecurrence(data.recurrence)
            : current.recurrence,
        url:
          data.url !== undefined ? coerceNullableString(data.url) : current.url,
        assignee_id:
          data.assigneeId !== undefined
            ? coerceNullableString(data.assigneeId)
            : current.assignee_id,
        // When a task was finished: set as it becomes done, cleared as it reopens (the Done column sorts by it).
        completed_at:
          data.isDone === undefined
            ? current.completed_at
            : data.isDone && !current.is_done
              ? updatedAt
              : data.isDone
                ? current.completed_at ?? updatedAt
                : null,
        priority:
          data.priority !== undefined
            ? coerceNullableNumber(data.priority)
            : current.priority,
        tags:
          data.tags !== undefined
            ? stringifyJsonArray(data.tags)
            : current.tags,
        sort_order:
          data.sortOrder !== undefined
            ? coerceNullableNumber(data.sortOrder)
            : current.sort_order,
        updated_at: updatedAt,
        deleted_at:
          data.deletedAt === undefined
            ? current.deleted_at
            : coerceNullableNumber(data.deletedAt),
        version: current.version + 1,
        updated_by: deviceId ?? current.updated_by,
      };

      updateStmt.run(newRow);
      return mapRow(findByIdStmt.get(id, userId));
    },
    applySync({ userId, record, deviceId }) {
      if (!record?.id) {
        return { applied: false, reason: "missing_id" };
      }

      const { raw, changedFields } = normalizeIncoming(record, {
        userId,
        deviceId,
      });

      const apply = db.transaction(() => {
        // Validate foreign key references exist
        if (raw.list_id) {
          const list = findListByIdStmt.get(raw.list_id);
          if (!list) {
            return { applied: false, reason: "list_not_found" };
          }
        }

        if (raw.parent_id) {
          const parentTask = findByIdOnlyStmt.get(raw.parent_id);
          if (!parentTask) {
            return { applied: false, reason: "parent_task_not_found" };
          }
        }

        if (raw.section_id) {
          const section = findSectionByIdStmt.get(raw.section_id);
          if (!section) {
            return { applied: false, reason: "section_not_found" };
          }
        }

        // Check if user owns the task OR has edit permission on the list
        const existingWithAccess = findByIdOrSharedStmt.get(raw.id, userId, userId);

        if (!existingWithAccess) {
          // User doesn't own this task and doesn't have access via shared list
          insertStmt.run(raw);
          return { applied: true, action: "inserted" };
        }

        const existing = mapRow(existingWithAccess);
        const listPermission = existingWithAccess.list_permission;

        // If user is accessing via shared list, preserve the original userId
        if (listPermission) {
          raw.user_id = existing.userId;
        }

        const priority = comparePriority(existing, raw, deviceId);
        if (priority > 0) {
          const updatedRow = {
            ...raw,
            created_at: existing.created_at,
          };
          updateStmt.run(updatedRow);
          return { applied: true, action: "replaced" };
        }

        if (priority === 0 && changedFields.length > 0) {
          const mergedRow = {
            ...existing,
          };

          for (const field of changedFields) {
            const key = FIELD_MAP.get(field);
            if (!key) {
              continue;
            }
            mergedRow[key] = raw[key];
          }

          mergedRow.updated_at = raw.updated_at;
          mergedRow.version = existing.version + 1;
          mergedRow.updated_by = deviceId ?? existing.updated_by;

          updateStmt.run(mergedRow);
          return { applied: true, action: "merged" };
        }

        return { applied: false, action: "skipped" };
      });

      return apply();
    },
    listSince({ userId, since }) {
      const rows = listSinceStmt.all(userId, since);
      return rows.map(mapRow);
    },
    listFromSharedLists({ userId, since }) {
      const stmt = db.prepare(`
        SELECT t.id, t.user_id, t.list_id, t.parent_id, t.section_id, t.title, t.notes, t.is_done,
          t.due_at, t.due_has_time, t.remind_at, t.flagged, t.recurrence, t.url, t.priority, t.tags, t.sort_order,
          t.created_at, t.updated_at, t.deleted_at, t.version, t.updated_by
        FROM tasks t
        JOIN task_list_shares tls ON t.list_id = tls.list_id
        WHERE tls.shared_with_user_id = ?
          AND t.updated_at > ?
          AND t.deleted_at IS NULL
        ORDER BY t.updated_at ASC
      `);
      const rows = stmt.all(userId, since);
      return rows.map(mapRow);
    },
    listInOwnedLists({ userId, since }) {
      // Get tasks created by other users in lists owned by this user (via list shares)
      const stmt = db.prepare(`
        SELECT t.id, t.user_id, t.list_id, t.parent_id, t.section_id, t.title, t.notes, t.is_done,
          t.due_at, t.due_has_time, t.remind_at, t.flagged, t.recurrence, t.url, t.priority, t.tags, t.sort_order,
          t.created_at, t.updated_at, t.deleted_at, t.version, t.updated_by
        FROM tasks t
        JOIN task_list_shares tls ON t.list_id = tls.list_id
        WHERE tls.shared_by_user_id = ?
          AND t.user_id != ?
          AND t.updated_at > ?
          AND t.deleted_at IS NULL
          AND tls.permission IN ('edit', 'admin')
        ORDER BY t.updated_at ASC
      `);
      const rows = stmt.all(userId, userId, since);
      return rows.map(mapRow);
    },
    countOverdue(userId) {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM tasks
        WHERE user_id = ?
          AND is_done = 0
          AND due_at < ?
          AND deleted_at IS NULL
      `);
      const result = stmt.get(userId, Date.now());
      return result ? result.count : 0;
    },

    findTasksDueWithoutNotification(cutoffTime) {
      const stmt = db.prepare(`
        SELECT t.*
        FROM tasks t
        LEFT JOIN task_notifications tn ON t.id = tn.task_id AND tn.type IN ('due', 'due_date')
        WHERE t.due_at <= ? 
          AND t.is_done = 0 
          AND t.deleted_at IS NULL
          AND tn.id IS NULL
      `);
      const rows = stmt.all(cutoffTime);
      return rows.map(mapRow);
    },

    findTasksNeedingReminders(cutoffTime) {
      const stmt = db.prepare(`
        SELECT t.*
        FROM tasks t
        LEFT JOIN task_notifications tn ON t.id = tn.task_id AND tn.type = 'reminder'
        WHERE t.remind_at <= ? 
          AND t.is_done = 0 
          AND t.deleted_at IS NULL
          AND tn.id IS NULL
      `);
      const rows = stmt.all(cutoffTime);
      return rows.map(mapRow);
    },

    findOverdueTasks() {
      const now = Date.now();
      const stmt = db.prepare(`
        SELECT t.*
        FROM tasks t
        LEFT JOIN task_notifications tn ON t.id = tn.task_id AND tn.type = 'overdue'
        WHERE t.due_at < ? 
          AND t.is_done = 0 
          AND t.deleted_at IS NULL
          AND tn.id IS NULL
      `);
      const rows = stmt.all(now);
      return rows.map(mapRow);
    },
  };
}
