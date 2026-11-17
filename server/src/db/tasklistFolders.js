import { coerceNullableNumber, coerceNullableString } from "./utils.js";
import { nanoid } from "nanoid";

const FOLDER_COLUMNS = "id, user_id, name, color, icon, sort_order, created_at, updated_at, deleted_at, version";

function mapRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color ?? null,
    icon: row.icon ?? null,
    sortOrder: coerceNullableNumber(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: coerceNullableNumber(row.deleted_at),
    version: row.version,
  };
}

function normalizeIncoming(payload, { userId }) {
  const createdAt =
    typeof payload.createdAt === "number" ? payload.createdAt : Date.now();
  const updatedAt =
    typeof payload.updatedAt === "number" ? payload.updatedAt : createdAt;

  return {
    id: payload.id,
    user_id: userId,
    name: payload.name ?? "",
    color: coerceNullableString(payload.color),
    icon: coerceNullableString(payload.icon),
    sort_order: coerceNullableNumber(payload.sortOrder),
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at:
      typeof payload.deletedAt === "number" && payload.deletedAt > 0
        ? payload.deletedAt
        : null,
    version:
      typeof payload.version === "number" && payload.version > 0
        ? payload.version
        : 1,
  };
}

function comparePriority(existingRow, incomingRow) {
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

  return 0;
}

export function createFoldersRepository(db) {
  const listStmt = db.prepare(`
    SELECT ${FOLDER_COLUMNS}
    FROM tasklist_folders
    WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at = 0)
    ORDER BY sort_order ASC
  `);

  const listSinceStmt = db.prepare(`
    SELECT ${FOLDER_COLUMNS}
    FROM tasklist_folders
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `);

  const findByIdStmt = db.prepare(`
    SELECT ${FOLDER_COLUMNS}
    FROM tasklist_folders
    WHERE id = ? AND user_id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO tasklist_folders (
      id, user_id, name, color, icon, sort_order, created_at, updated_at, deleted_at, version
    ) VALUES (
      @id, @user_id, @name, @color, @icon, @sort_order, @created_at, @updated_at, @deleted_at, @version
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE tasklist_folders
    SET
      name = @name,
      color = @color,
      icon = @icon,
      sort_order = @sort_order,
      updated_at = @updated_at,
      deleted_at = @deleted_at,
      version = @version
    WHERE id = @id AND user_id = @user_id
  `);

  return {
    getAllFolders(userId) {
      const rows = listStmt.all(userId);
      return rows.map(mapRow);
    },

    getFolderById(userId, folderId) {
      const row = findByIdStmt.get(folderId, userId);
      return mapRow(row);
    },

    getFoldersSince(userId, since) {
      const rows = listSinceStmt.all(userId, since);
      return rows.map(mapRow);
    },

    create(userId, data) {
      const normalized = normalizeIncoming({ id: data.id ?? nanoid(), ...data }, { userId });
      insertStmt.run(normalized);
      return this.getFolderById(userId, normalized.id);
    },

    update(userId, id, data) {
      const existing = findByIdStmt.get(id, userId);
      if (!existing) return null;

      const normalized = {
        id,
        user_id: userId,
        name: data.name ?? existing.name,
        color: data.color !== undefined ? coerceNullableString(data.color) : existing.color,
        icon: data.icon !== undefined ? coerceNullableString(data.icon) : existing.icon,
        sort_order: data.sortOrder !== undefined ? coerceNullableNumber(data.sortOrder) : existing.sort_order,
        updated_at: data.updatedAt ?? Date.now(),
        deleted_at: data.deletedAt !== undefined ? (data.deletedAt > 0 ? data.deletedAt : null) : existing.deleted_at,
        version: (data.version ?? existing.version) + 1,
      };

      updateStmt.run(normalized);
      return this.getFolderById(userId, id);
    },

    applySync({ userId, record }) {
      if (!record?.id) {
        return { applied: false, reason: "missing_id" };
      }

      const incoming = normalizeIncoming(record, { userId });

      const apply = db.transaction(() => {
        const existing = findByIdStmt.get(record.id, userId);

        if (!existing) {
          insertStmt.run(incoming);
          return { applied: true, action: "inserted" };
        }

        const priority = comparePriority(existing, incoming);
        if (priority > 0) {
          updateStmt.run(incoming);
          return { applied: true, action: "replaced" };
        }

        return { applied: false, action: "skipped" };
      });

      return apply();
    },

    delete(userId, id) {
      const stmt = db.prepare('DELETE FROM tasklist_folders WHERE id = ? AND user_id = ?');
      return stmt.run(id, userId);
    },

    softDelete(userId, id) {
      const timestamp = Date.now();
      const existing = findByIdStmt.get(id, userId);
      if (!existing) return;

      const stmt = db.prepare(
        'UPDATE tasklist_folders SET deleted_at = ?, updated_at = ?, version = ? WHERE id = ? AND user_id = ?'
      );
      return stmt.run(timestamp, timestamp, (existing.version || 1) + 1, id, userId);
    },
  };
}
