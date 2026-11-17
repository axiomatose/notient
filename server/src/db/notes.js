import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import TurndownService from "turndown";
import { marked } from "marked";
import { stringifyJsonArray, parseJsonArray, integerToBoolean, booleanToInteger, coerceNullableNumber } from "./utils.js";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const NOTE_COLUMNS =
  "id, user_id, title, body, is_pinned, tags, folder, sort_order, created_at, updated_at, deleted_at, version, updated_by";

const FIELD_MAP = new Map([
  ["title", "title"],
  ["body", "body"],
  ["is_pinned", "is_pinned"],
  ["isPinned", "is_pinned"],
  ["tags", "tags"],
  ["folder", "folder"],
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
    title: row.title,
    body: row.body,
    isPinned: integerToBoolean(row.is_pinned),
    tags: parseJsonArray(row.tags),
    folder: row.folder ?? null,
    sortOrder: coerceNullableNumber(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: coerceNullableNumber(row.deleted_at),
    version: row.version,
    updatedBy: row.updated_by || null,
    permission: row.permission || null,
    sharedWith: row.sharedWith ? parseJsonArray(row.sharedWith) : [],
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
      title: payload.title ?? "",
      body: "", // Always store empty string in DB
      is_pinned: booleanToInteger(Boolean(payload.isPinned)),
      tags: stringifyJsonArray(payload.tags ?? []),
      folder:
        typeof payload.folder === "string"
          ? payload.folder.trim() || null
          : payload.folder === null
            ? null
            : null,
      sort_order: payload.sortOrder ?? null,
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
    realBody: payload.body ?? "", // Return real body specifically
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

export function createNotesRepository(db, config) {
  const listStmt = db.prepare(`
    SELECT ${NOTE_COLUMNS}
    FROM notes
    WHERE user_id = @userId
      AND (@includeDeleted = 1 OR deleted_at IS NULL)
    ORDER BY updated_at DESC
  `);

  const findByIdStmt = db.prepare(`
    SELECT n.*, ns.permission
    FROM notes n
    LEFT JOIN note_shares ns ON ns.note_id = n.id AND ns.shared_with_user_id = ?
    WHERE n.id = ? AND (n.user_id = ? OR ns.id IS NOT NULL)
  `);

  const findByIdOnlyStmt = db.prepare(`
    SELECT ${NOTE_COLUMNS}
    FROM notes
    WHERE id = ?
  `);

  const findEditableStmt = db.prepare(`
    SELECT ${NOTE_COLUMNS}
    FROM notes
    WHERE id = ? AND (
      user_id = ?
      OR EXISTS (
        SELECT 1 FROM note_shares
        WHERE note_shares.note_id = notes.id
          AND note_shares.shared_with_user_id = ?
          AND note_shares.permission = 'edit'
      )
    )
  `);

  const fetchSharesStmt = db.prepare(`
    SELECT u.email, ns.permission, ns.created_at as sharedAt
    FROM note_shares ns
    JOIN users u ON u.id = ns.shared_with_user_id
    WHERE ns.note_id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO notes (
      id, user_id, title, body, is_pinned, tags, folder, sort_order,
      created_at, updated_at, deleted_at, version, updated_by
    ) VALUES (
      @id, @user_id, @title, @body, @is_pinned, @tags, @folder, @sort_order,
      @created_at, @updated_at, @deleted_at, @version, @updated_by
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE notes
    SET
      title = @title,
      body = @body,
      is_pinned = @is_pinned,
      tags = @tags,
      folder = @folder,
      sort_order = @sort_order,
      updated_at = @updated_at,
      deleted_at = @deleted_at,
      version = @version,
      updated_by = @updated_by
    WHERE id = @id AND (
      user_id = @current_user_id
      OR EXISTS (
        SELECT 1 FROM note_shares
        WHERE note_shares.note_id = notes.id
          AND note_shares.shared_with_user_id = @current_user_id
          AND note_shares.permission = 'edit'
      )
    )
  `);

  const listSinceStmt = db.prepare(`
    SELECT ${NOTE_COLUMNS}
    FROM notes
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `);

  function getNotePath(userId, noteId) {
    if (!config?.notesDir) return null;
    return join(config.notesDir, userId, `${noteId}.md`);
  }

  function readMarkdown(userId, noteId) {
    try {
      const p = getNotePath(userId, noteId);
      if (p && existsSync(p)) {
        return readFileSync(p, "utf8");
      }
    } catch (e) {
      // ignore
    }
    return "";
  }

  // Verbatim write: the file is the source of truth for `bodyMarkdown`.
  function writeMarkdown(userId, noteId, md) {
    try {
      if (!config?.notesDir) return;
      const p = getNotePath(userId, noteId);
      const dir = join(config.notesDir, userId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(p, md, "utf8");
    } catch (e) { console.error("Write error", e); }
  }

  // Legacy HTML body -> Markdown file (turndown).
  function writeContent(userId, noteId, html) {
    let md;
    try {
      md = turndownService.turndown(html || "");
    } catch (e) {
      console.error("Write error", e);
      return;
    }
    writeMarkdown(userId, noteId, md);
  }

  // Attaches `bodyMarkdown` (raw file) and `body` (HTML via marked, legacy web client).
  function hydrateBody(note) {
    const md = readMarkdown(note.userId, note.id);
    note.bodyMarkdown = md;
    note.body = marked.parse(md);
    return note;
  }

  return {
    list({ userId, includeDeleted = false }) {
      const rows = listStmt.all({
        userId,
        includeDeleted: includeDeleted ? 1 : 0,
      });
      return rows.map(row => {
        const note = mapRow(row);
        hydrateBody(note);
        note.sharedWith = fetchSharesStmt.all(note.id);
        return note;
      });
    },
    findById({ userId, id }) {
      const row = findByIdStmt.get(userId, id, userId);
      if (!row) return null;
      const note = mapRow(row);
      hydrateBody(note);
      // If user is owner, fetch all shares
      if (note.userId === userId) {
        note.sharedWith = fetchSharesStmt.all(note.id);
      }
      return note;
    },
    findByIdOnly(id) {
      const row = findByIdOnlyStmt.get(id);
      const note = mapRow(row);
      if (note) {
        hydrateBody(note);
      }
      return note;
    },
    create({ userId, data, deviceId }) {
      const normalized = normalizeIncoming(
        {
          ...data,
          id: data.id,
          createdAt: data.createdAt ?? Date.now(),
          updatedAt: data.updatedAt ?? Date.now(),
          version: data.version ?? 1,
        },
        { userId, deviceId },
      );

      // bodyMarkdown wins over the legacy HTML body when present.
      if (typeof data.bodyMarkdown === "string") {
        writeMarkdown(userId, normalized.raw.id, data.bodyMarkdown);
      } else {
        writeContent(userId, normalized.raw.id, normalized.realBody);
      }

      insertStmt.run(normalized.raw);
      return this.findById({ userId, id: normalized.raw.id });
    },
    update({ userId, id, data, deviceId }) {
      const current = findEditableStmt.get(id, userId, userId);
      if (!current) {
        return null;
      }

      const updatedAt = data.updatedAt ?? Date.now();

      const newRow = {
        ...current,
        title: data.title ?? current.title,
        body: "", // Always empty in DB
        is_pinned:
          data.isPinned !== undefined
            ? booleanToInteger(Boolean(data.isPinned))
            : current.is_pinned,
        tags:
          data.tags !== undefined
            ? stringifyJsonArray(data.tags)
            : current.tags,
        folder:
          data.folder !== undefined
            ? data.folder === null
              ? null
              : data.folder
            : current.folder,
        sort_order:
          data.sortOrder !== undefined
            ? data.sortOrder
            : current.sort_order,
        updated_at: updatedAt,
        deleted_at:
          data.deletedAt === undefined
            ? current.deleted_at
            : coerceNullableNumber(data.deletedAt),
        version: current.version + 1,
        updated_by: deviceId ?? current.updated_by,
        current_user_id: userId,
      };
      
      // bodyMarkdown wins over the legacy HTML body when present.
      if (typeof data.bodyMarkdown === "string") {
        writeMarkdown(userId, id, data.bodyMarkdown);
      } else if (data.body !== undefined) {
        writeContent(userId, id, data.body);
      }
      
      updateStmt.run(newRow);
      return this.findById({ userId, id });
    },
    applySync({ userId, record, deviceId }) {
      if (!record?.id) {
        return { applied: false, reason: "missing_id" };
      }

      const { raw, changedFields, realBody } = normalizeIncoming(record, {
        userId,
        deviceId,
      });

      const apply = db.transaction(() => {
        // write body if present
        if (record.body !== undefined) {
             writeContent(userId, raw.id, realBody);
        }
        // Check if note exists globally first
        const globalExisting = findByIdOnlyStmt.get(raw.id);
        
        // If it doesn't exist globally, we can insert it (pusher will be owner)
        if (!globalExisting) {
          insertStmt.run(raw);
          return { applied: true, action: "inserted" };
        }

        // If it exists globally, check if the pusher has access to it
        const existing = findByIdStmt.get(userId, raw.id, userId);

        if (!existing) {
          // Note exists but pusher has no access to it
          return { applied: false, reason: "permission_denied" };
        }

        // Pusher has access, check if they are owner or have edit permission
        const isOwner = existing.user_id === userId;
        const canEdit = isOwner || existing.permission === 'edit';

        if (!canEdit) {
          return { applied: false, reason: "read_only" };
        }

        const priority = comparePriority(existing, raw, deviceId);
        if (priority > 0) {
          const updatedRow = {
            ...raw,
            user_id: existing.user_id, // Preserve owner
            body: "", // Ensure DB has empty body
            created_at: existing.created_at,
            current_user_id: userId,
          };
          updateStmt.run(updatedRow);
          return { applied: true, action: "replaced" };
        }

        if (priority === 0 && changedFields.length > 0) {
          const mergedRow = {
            ...existing,
          };

          for (const field of FIELD_MAP.keys()) {
            if (changedFields.includes(field)) {
              if (field === "body") {
                  // body handled outside loop via writeContent
                  continue;
              }
              const key = FIELD_MAP.get(field);
              mergedRow[key] = raw[key];
            }
          }
          mergedRow.body = ""; // Ensure DB has empty body if merging

          mergedRow.updated_at = raw.updated_at;
          mergedRow.version = existing.version + 1;
          mergedRow.updated_by = deviceId ?? existing.updated_by;
          mergedRow.current_user_id = userId;

          updateStmt.run(mergedRow);
          return { applied: true, action: "merged" };
        }

        return { applied: false, action: "skipped" };
      });

      return apply();
    },
    deletePermanently({ userId, id }) {
      // Delete the file first
      try {
        const p = getNotePath(userId, id);
        if (p && existsSync(p)) {
          // unlinkSync is imported at top level now
          unlinkSync(p);
        }
      } catch (e) {
        console.error("Error deleting file:", e);
      }
      
      const deleteStmt = db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?");
      const deleteSharesStmt = db.prepare("DELETE FROM note_shares WHERE note_id = ?"); 
      
      const doDelete = db.transaction(() => {
        deleteSharesStmt.run(id);
        const info = deleteStmt.run(id, userId);
        return info.changes > 0;
      });
      
      return doDelete();
    },
    listSince({ userId, since }) {
      const rows = listSinceStmt.all(userId, since);
      return rows.map(row => {
        const note = mapRow(row);
        hydrateBody(note);
        note.sharedWith = fetchSharesStmt.all(note.id);
        return note;
      });
    },
    listSharedSince({ userId, since }) {
      const stmt = db.prepare(`
        SELECT 
          n.*,
          ns.permission,
          ns.created_at as sharedAt
        FROM note_shares ns
        LEFT JOIN notes n ON n.id = ns.note_id
        WHERE ns.shared_with_user_id = ? 
          AND (n.id IS NOT NULL)
          AND (n.deleted_at IS NULL OR n.deleted_at = 0)
        ORDER BY n.updated_at ASC
      `);
      const rows = stmt.all(userId);
      return rows.map(row => {
        const note = mapRow(row);
        hydrateBody(note);
        return {
          ...note,
          permission: row.permission,
          sharedAt: row.sharedAt,
        };
      });
    },
  };
}
