import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";

import logger from "../utils/logger.js";

const timestampSchema = z.number().nonnegative();

const pullSchema = z.object({
  since: z
    .string()
    .transform((value) => Number(value))
    .pipe(z.number().nonnegative())
    .optional(),
});

const changedFieldsSchema = z.array(z.string().trim()).optional().default([]);

const noteRecordSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().optional(),
  body: z.string().optional(),
  isPinned: z.boolean().optional(),
  tags: z.array(z.string().trim()).optional(),
  folder: z.string().optional().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: z.number().nonnegative().nullable().optional(),
  version: z.number().int().positive().optional(),
  changedFields: changedFieldsSchema,
});

const listRecordSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().optional(),
  icon: z.string().max(32).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().finite().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: z.number().nonnegative().nullable().optional(),
  version: z.number().int().positive().optional(),
  changedFields: changedFieldsSchema,
});

const sectionRecordSchema = z.object({
  id: z.string().trim().min(1).max(64),
  listId: z.string().trim().min(1),
  name: z.string().optional(),
  sortOrder: z.number().finite().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: z.number().nonnegative().nullable().optional(),
  version: z.number().int().positive().optional(),
  changedFields: changedFieldsSchema,
});

const taskRecordSchema = z.object({
  id: z.string().trim().min(1).max(64),
  listId: z.string().trim().min(1),
  parentId: z.string().trim().min(1).nullable().optional(),
  sectionId: z.string().trim().min(1).nullable().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
  isDone: z.boolean().optional(),
  dueAt: z.number().finite().nullable().optional(),
  remindAt: z.number().finite().nullable().optional(),
  priority: z.number().finite().nullable().optional(),
  tags: z.array(z.string().trim()).optional(),
  folder: z.string().optional().nullable(),
  sortOrder: z.number().finite().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: z.number().nonnegative().nullable().optional(),
  version: z.number().int().positive().optional(),
  changedFields: changedFieldsSchema,
});

const folderRecordSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().optional(),
  color: z.string().max(32).nullable().optional(),
  icon: z.string().max(32).nullable().optional(),
  sortOrder: z.number().finite().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: z.number().nonnegative().nullable().optional(),
  version: z.number().int().positive().optional(),
  changedFields: changedFieldsSchema,
});

const pushSchema = z.object({
  deviceId: z.string().trim().min(1),
  notes: z.array(noteRecordSchema).optional().default([]),
  lists: z.array(listRecordSchema).optional().default([]),
  sections: z.array(sectionRecordSchema).optional().default([]),
  tasks: z.array(taskRecordSchema).optional().default([]),
  folders: z.array(folderRecordSchema).optional().default([]),
});

function ensureDeviceExists({ repos, userId, deviceId, deviceName, timestamp }) {
  const updated = repos.devices.touch({
    id: deviceId,
    userId,
    name: deviceName,
    timestamp,
  });

  if (!updated) {
    repos.devices.create({
      id: deviceId,
      user_id: userId,
      name: deviceName ?? "Unknown device",
      last_seen: timestamp,
    });
  }
}

export function createSyncRouter({ config, repos, requireAuth, db }) {
  const router = Router();

  router.use(requireAuth);

  router.get("/pull", (req, res, next) => {
    (async () => {
      const query = pullSchema.parse(req.query ?? {});
      const { userId, deviceId, device } = req.auth;
      const now = Date.now();

      const checkpointRow = repos.checkpoints.find(deviceId);
      const since = query.since ?? checkpointRow?.last_pull ?? 0;

      ensureDeviceExists({
        repos,
        userId,
        deviceId,
        deviceName: device?.name,
        timestamp: now,
      });

      logger.info('[SYNC] Pulling for userId since', { userId, since });
      const sharedNotes = repos.notes.listSharedSince({ userId, since });
      const taskListShares = repos.taskListShares.listSince({ userId, since });
      const taskShares = repos.taskShares.listSince({ userId, since });
      
      const folders = repos.folders.getFoldersSince(userId, since);
      const sharedListTasks = repos.tasks.listFromSharedLists({ userId, since });
      const tasksInOwnedLists = repos.tasks.listInOwnedLists({ userId, since });
      
      logger.info('[SYNC] Shared items counts', {
        userId,
        notes: sharedNotes.length,
        lists: taskListShares.length,
        tasks: taskShares.length,
        folders: folders.length,
        sharedListTasks: sharedListTasks.length,
        tasksInOwnedLists: tasksInOwnedLists.length
      });
      
      // Combine: user's own tasks + tasks from shared lists + tasks created by others in user's lists
      const userTasks = repos.tasks.listSince({ userId, since });
      const allTasks = [...userTasks, ...sharedListTasks, ...tasksInOwnedLists];
      
      // Remove duplicates (keep one with highest version/updated_at)
      const taskMap = new Map();
      for (const task of allTasks) {
        const existing = taskMap.get(task.id);
        if (!existing || task.updatedAt > existing.updatedAt || (task.updatedAt === existing.updatedAt && task.version > existing.version)) {
          taskMap.set(task.id, task);
        }
      }
      
      const payload = {
        userId,
        since,
        checkpoint: now,
        lists: repos.taskLists.listSince({ userId, since }),
        sections: repos.taskSections.listSince({ userId, since }),
        tasks: Array.from(taskMap.values()),
        notes: repos.notes.listSince({ userId, since }),
        folders,
        sharedNotes,
        taskListShares,
        taskShares,
      };

      repos.checkpoints.update({ deviceId, timestamp: now });

      res.json(payload);
    })().catch((error) => {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid query parameters", "invalid_query"));
        return;
      }
      next(error);
    });
  });

  router.post("/push", (req, res, next) => {
    (async () => {
      const body = pushSchema.parse(req.body ?? {});
      const { userId, deviceId, device } = req.auth;

      if (body.deviceId !== deviceId) {
        throw new HttpError(403, "Device mismatch", "device_mismatch");
      }

      const now = Date.now();

      ensureDeviceExists({
        repos,
        userId,
        deviceId,
        deviceName: device?.name,
        timestamp: now,
      });

      const results = {
        notes: { received: body.notes.length, applied: 0, merged: 0, skipped: 0 },
        lists: { received: body.lists.length, applied: 0, merged: 0, skipped: 0 },
        sections: { received: body.sections.length, applied: 0, merged: 0, skipped: 0 },
        tasks: { received: body.tasks.length, applied: 0, merged: 0, skipped: 0 },
        folders: { received: body.folders.length, applied: 0, merged: 0, skipped: 0 },
      };

      for (const note of body.notes) {
        const outcome = repos.notes.applySync({
          userId,
          deviceId,
          record: note,
        });
        if (outcome.applied) {
          results.notes.applied += 1;
          if (outcome.action === "merged") {
            results.notes.merged += 1;
          }
        } else {
          results.notes.skipped += 1;
        }
      }

      for (const list of body.lists) {
        const outcome = repos.taskLists.applySync({
          userId,
          deviceId,
          record: list,
        });
        if (outcome.applied) {
          results.lists.applied += 1;
          if (outcome.action === "merged") {
            results.lists.merged += 1;
          }
        } else {
          results.lists.skipped += 1;
        }
      }

      for (const section of body.sections) {
        const outcome = repos.taskSections.applySync({
          userId,
          deviceId,
          record: section,
        });
        if (outcome.applied) {
          results.sections.applied += 1;
          if (outcome.action === "merged") {
            results.sections.merged += 1;
          }
        } else {
          results.sections.skipped += 1;
        }
      }

      for (const task of body.tasks) {
        const outcome = repos.tasks.applySync({
          userId,
          deviceId,
          record: task,
        });
        if (outcome.applied) {
          results.tasks.applied += 1;
          if (outcome.action === "merged") {
            results.tasks.merged += 1;
          }
        } else {
          results.tasks.skipped += 1;
        }
      }

      for (const folder of body.folders) {
        const outcome = repos.folders.applySync({
          userId,
          record: folder,
        });
        if (outcome.applied) {
          results.folders.applied += 1;
        } else {
          results.folders.skipped += 1;
        }
      }

      const checkpoint = Date.now();

      res.json({
        userId,
        checkpoint,
        results,
      });
    })().catch((error) => {
      if (error instanceof HttpError) {
        next(error);
        return;
      }
      if (error instanceof z.ZodError) {
        console.error("Sync PUSH validation error:", JSON.stringify(error.format(), null, 2));
        next(new HttpError(400, `Invalid request body: ${JSON.stringify(error.format())}`, "invalid_body"));
        return;
      }
      next(error);
    });
  });

  return router;
}
