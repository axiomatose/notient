import {
  coerceNullableNumber,
  coerceNullableString,
} from "./utils.js";

const SECTION_COLUMNS =
  "id, user_id, list_id, name, icon, color, sort_order, created_at, updated_at, deleted_at, version, updated_by";

const FIELD_MAP = new Map([
  ["name", "name"],
  ["icon", "icon"],
  ["color", "color"],
  ["list_id", "list_id"],
  ["listId", "list_id"],
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
    name: row.name,
    icon: coerceNullableString(row.icon),
    color: coerceNullableString(row.color),
    sortOrder: coerceNullableNumber(row.sort_order),
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
      name: payload.name ?? "",
      icon: coerceNullableString(payload.icon),
      color: coerceNullableString(payload.color),
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

export function createTaskSectionsRepository(db) {
  const listStmt = db.prepare(`
    SELECT ${SECTION_COLUMNS}
    FROM task_sections
    WHERE user_id = @userId
      AND list_id = @listId
      AND (@includeDeleted = 1 OR deleted_at IS NULL)
    ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC
  `);

  const listAllStmt = db.prepare(`
    SELECT ${SECTION_COLUMNS}
    FROM task_sections
    WHERE user_id = @userId
      AND (@includeDeleted = 1 OR deleted_at IS NULL)
    ORDER BY updated_at DESC
  `);

  const findByIdStmt = db.prepare(`
    SELECT ${SECTION_COLUMNS}
    FROM task_sections
    WHERE id = ? AND user_id = ?
  `);

  const findAnyByIdStmt = db.prepare(`
    SELECT ${SECTION_COLUMNS}
    FROM task_sections
    WHERE id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO task_sections (
      id, user_id, list_id, name, icon, color, sort_order,
      created_at, updated_at, deleted_at, version, updated_by
    ) VALUES (
      @id, @user_id, @list_id, @name, @icon, @color, @sort_order,
      @created_at, @updated_at, @deleted_at, @version, @updated_by
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE task_sections
    SET
      list_id = @list_id,
      name = @name,
      icon = @icon,
      color = @color,
      sort_order = @sort_order,
      updated_at = @updated_at,
      deleted_at = @deleted_at,
      version = @version,
      updated_by = @updated_by
    WHERE id = @id AND user_id = @user_id
  `);

  const listSinceStmt = db.prepare(`
    SELECT ${SECTION_COLUMNS}
    FROM task_sections
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `);

  return {
    list({ userId, listId, includeDeleted = false }) {
      const stmt = listId ? listStmt : listAllStmt;
      const rows = stmt.all({
        userId,
        listId,
        includeDeleted: includeDeleted ? 1 : 0,
      });
      return rows.map(mapRow);
    },
    findById({ userId, id }) {
      const row = findByIdStmt.get(id, userId);
      return mapRow(row);
    },
    /** A section whoever owns it: callers check access to its list. */
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
        name: data.name ?? current.name,
        icon:
          data.icon !== undefined
            ? coerceNullableString(data.icon)
            : current.icon,
        color:
          data.color !== undefined
            ? coerceNullableString(data.color)
            : current.color,
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
        const existing = findByIdStmt.get(raw.id, userId);

        if (!existing) {
          insertStmt.run(raw);
          return { applied: true, action: "inserted" };
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
  };
}
