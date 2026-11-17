import {
  coerceNullableNumber,
  coerceNullableString,
} from "./utils.js";

const LIST_COLUMNS =
  "id, user_id, name, icon, color, folder_id, uncategorized_name, grocery_mode, view_mode, sort_order, created_at, updated_at, deleted_at, version, updated_by";

const FIELD_MAP = new Map([
  ["name", "name"],
  ["icon", "icon"],
  ["color", "color"],
  ["folderId", "folder_id"],
  ["folder_id", "folder_id"],
  ["uncategorizedName", "uncategorized_name"],
  ["groceryMode", "grocery_mode"],
  ["viewMode", "view_mode"],
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
    name: row.name,
    icon: coerceNullableString(row.icon),
    color: coerceNullableString(row.color),
    folderId: coerceNullableString(row.folder_id),
    uncategorizedName: coerceNullableString(row.uncategorized_name),
    groceryMode: row.grocery_mode === 1,
    viewMode: coerceNullableString(row.view_mode),
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
      name: payload.name ?? "",
      icon: coerceNullableString(payload.icon),
      color: coerceNullableString(payload.color),
      folder_id: coerceNullableString(payload.folderId),
      uncategorized_name: coerceNullableString(payload.uncategorizedName),
      grocery_mode: payload.groceryMode ? 1 : 0,
      view_mode: coerceNullableString(payload.viewMode),
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

export function createTaskListsRepository(db) {
  const listStmt = db.prepare(`
    SELECT ${LIST_COLUMNS}
    FROM task_lists
    WHERE user_id = @userId
      AND (@includeDeleted = 1 OR deleted_at IS NULL)
    ORDER BY COALESCE(sort_order, 0) ASC, updated_at DESC
  `);

  const findByIdStmt = db.prepare(`
    SELECT ${LIST_COLUMNS}
    FROM task_lists
    WHERE id = ? AND user_id = ?
  `);

  const findByIdOnlyStmt = db.prepare(`
    SELECT ${LIST_COLUMNS}
    FROM task_lists
    WHERE id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO task_lists (
      id, user_id, name, icon, color, folder_id, uncategorized_name, grocery_mode, view_mode, sort_order,
      created_at, updated_at, deleted_at, version, updated_by
    ) VALUES (
      @id, @user_id, @name, @icon, @color, @folder_id, @uncategorized_name, @grocery_mode, @view_mode, @sort_order,
      @created_at, @updated_at, @deleted_at, @version, @updated_by
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE task_lists
    SET
      name = @name,
      icon = @icon,
      color = @color,
      folder_id = @folder_id,
      uncategorized_name = @uncategorized_name,
      grocery_mode = @grocery_mode,
      view_mode = @view_mode,
      sort_order = @sort_order,
      updated_at = @updated_at,
      deleted_at = @deleted_at,
      version = @version,
      updated_by = @updated_by
    WHERE id = @id AND user_id = @user_id
  `);

  const listSinceStmt = db.prepare(`
    SELECT DISTINCT tl.*
    FROM task_lists tl
    LEFT JOIN task_list_shares tls ON tl.id = tls.list_id
    WHERE (tl.user_id = ? OR tls.shared_with_user_id = ?)
      AND tl.updated_at > ?
    ORDER BY tl.updated_at ASC
  `);

  return {
    list({ userId, includeDeleted = false }) {
      const rows = listStmt.all({
        userId,
        includeDeleted: includeDeleted ? 1 : 0,
      });
      return rows.map(mapRow);
    },
    findById({ userId, id }) {
      const row = findByIdStmt.get(id, userId);
      return mapRow(row);
    },
    findByIdOnly(id) {
      const row = findByIdOnlyStmt.get(id);
      return mapRow(row);
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
        name: data.name ?? current.name,
        icon:
          data.icon !== undefined
            ? coerceNullableString(data.icon)
            : current.icon,
        color:
          data.color !== undefined
            ? coerceNullableString(data.color)
            : current.color,
        folder_id:
          data.folderId !== undefined
            ? coerceNullableString(data.folderId, true)
            : current.folder_id,
        uncategorized_name:
          data.uncategorizedName !== undefined
            ? coerceNullableString(data.uncategorizedName)
            : current.uncategorized_name,
        grocery_mode:
          data.groceryMode !== undefined
            ? (data.groceryMode ? 1 : 0)
            : current.grocery_mode,
        view_mode:
          data.viewMode !== undefined
            ? coerceNullableString(data.viewMode)
            : current.view_mode,
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
      const rows = listSinceStmt.all(userId, userId, since);
      return rows.map(mapRow);
    },
  };
}
