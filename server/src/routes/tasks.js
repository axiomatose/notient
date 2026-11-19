import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { HttpError } from "../errors.js";
import { createListAccess } from "../lib/listAccess.js";
import {
  RECURRENCES,
  isRepeating,
  nextDueAt,
} from "../lib/recurrence.js";

const recurrenceSchema = z.enum(RECURRENCES);
const urlSchema = z.string().trim().max(2000);

const querySchema = z.object({
  includeDeleted: z
    .string()
    .transform((value) => value.toLowerCase() === "true")
    .optional(),
  listId: z.string().trim().min(1).optional(),
  parentId: z.string().trim().min(1).optional(),
  since: z
    .string()
    .transform((value) => Number(value))
    .pipe(z.number().nonnegative())
    .optional(),
});

const createSchema = z.object({
  id: z.string().trim().min(10).max(64).optional(),
  listId: z.string().trim().min(1),
  parentId: z.string().trim().min(1).nullable().optional(),
  sectionId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1),
  notes: z.string().optional(),
  isDone: z.boolean().optional(),
  dueAt: z.number().finite().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  remindAt: z.number().finite().nullable().optional(),
  flagged: z.boolean().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  url: urlSchema.nullable().optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
  priority: z.number().finite().nullable().optional(),
  tags: z.array(z.string().trim()).optional(),
  sortOrder: z.number().finite().nullable().optional(),
});

const updateSchema = z
  .object({
    listId: z.string().trim().min(1).optional(),
    parentId: z.string().trim().min(1).nullable().optional(),
    sectionId: z.string().trim().min(1).nullable().optional(),
    title: z.string().optional(),
    notes: z.string().optional(),
    isDone: z.boolean().optional(),
    dueAt: z.number().finite().nullable().optional(),
    dueHasTime: z.boolean().optional(),
    remindAt: z.number().finite().nullable().optional(),
    flagged: z.boolean().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    url: urlSchema.nullable().optional(),
    assigneeId: z.string().trim().min(1).nullable().optional(),
    priority: z.number().finite().nullable().optional(),
    tags: z.array(z.string().trim()).optional(),
    sortOrder: z.number().finite().nullable().optional(),
    deletedAt: z.number().nonnegative().nullable().optional(),
  })
  .refine(
    (data) =>
      Object.values(data).some(
        (value) => value !== undefined,
      ),
    {
      message: "No changes provided",
    },
  );

export function createTasksRouter({ repos, requireAuth, liveHub = null, notificationService = null }) {
  const router = Router();
  const access = createListAccess(repos);

  // Tell someone they were given a task: a notification row (the bell lists it) and a live nudge to refresh it.
  function notifyAssignee(task, actorId) {
    if (!task?.assigneeId || task.assigneeId === actorId) return;
    const actor = repos.users.getProfile(actorId);
    const list = repos.taskLists.findByIdOnly(task.listId);
    const now = Date.now();
    repos.taskNotifications.create({
      taskId: task.id,
      userId: task.assigneeId,
      type: "assigned",
      scheduledAt: now,
      sentAt: now,
      payload: {
        taskTitle: task.title,
        listName: list?.name ?? "",
        listId: task.listId,
        byUserId: actorId,
        byName: actor?.display_name || actor?.email || "Someone",
      },
    });
    liveHub?.send([task.assigneeId], { type: "notify", kind: "notifications" });
    // Reaches a closed app too (web push); a failed push never fails the request.
    notificationService
      ?.sendPushNotification(task.assigneeId, "Task assigned to you", {
        body: `${actor?.display_name || actor?.email || "Someone"} assigned you "${task.title}"`,
        data: { url: `/tasks?list=${task.listId}` },
      })
      .catch(() => {});
  }

  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      const query = querySchema.parse(req.query ?? {});
      const { userId: me } = req.auth;
      // A list shared with me is read as its owner's.
      const shared = query.listId
        ? access.forList(query.listId, me)
        : query.parentId
          ? access.forTask(query.parentId, me)
          : null;
      const userId = access.readAs(shared, me);

      if (query.since !== undefined) {
        const tasks = repos.tasks.listSince({
          userId,
          since: query.since,
        });
        res.json({ tasks, since: query.since, count: tasks.length });
        return;
      }

      const tasks = repos.tasks.list({
        userId,
        listId: query.listId ?? null,
        parentId: query.parentId ?? null,
        includeDeleted: query.includeDeleted ?? false,
      });
      res.json({ tasks, count: tasks.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid query parameters", "invalid_query"));
        return;
      }
      next(error);
    }
  });

  // Everything a board or list screen shows, in one round trip: the list's sections, top-level tasks,
  // every subtask of those tasks, and the people on the list. Same access as the four reads it combines.
  router.get("/board", (req, res, next) => {
    try {
      const { listId } = z.object({ listId: z.string().trim().min(1) }).parse(req.query ?? {});
      const { userId: me } = req.auth;
      const shared = access.forList(listId, me);
      if (!shared) {
        throw new HttpError(404, "Task list not found", "task_list_not_found");
      }
      const userId = access.readAs(shared, me);
      const tasks = repos.tasks.list({ userId, listId });
      const subtasks = tasks
        .filter((task) => (task.subtaskCount ?? 0) > 0)
        .flatMap((task) => repos.tasks.list({ userId, parentId: task.id }));
      res.json({
        sections: repos.taskSections.list({ userId, listId }),
        tasks,
        subtasks,
        members: access.members(listId),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid query parameters", "invalid_query"));
        return;
      }
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
    (async () => {
      const { deviceId } = req.auth;
      const input = await createSchema.parseAsync(req.body ?? {});
      const userId = access.writeAs(access.forList(input.listId, req.auth.userId), req.auth.userId);
      if (input.assigneeId && !access.isMember(input.listId, input.assigneeId)) {
        throw new HttpError(400, "Assignee is not on this list", "invalid_assignee");
      }

      const timestamp = Date.now();
      // Notes given with a new task are its first note, by whoever made it.
      const { notes: firstNote, ...fields } = input;
      const data = {
        ...fields,
        id: input.id ?? nanoid(),
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };

      const task = repos.tasks.create({
        userId,
        deviceId,
        data,
      });
      if (firstNote?.trim()) repos.taskNotes.create({ taskId: task.id, userId: req.auth.userId, body: firstNote.trim() });
      notifyAssignee(task, req.auth.userId);

      res.status(201).json({ task });
    })().catch((error) => {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid request body", "invalid_body"));
        return;
      }
      next(error);
    });
  });

  // A task's notes: a thread of notes, each with its author and time. Anyone who can read the task reads it;
  // anyone who can write adds a note; a note's author (or the list's owner) removes it.
  // The task's access for this person: through its list, or as the task's own owner; anyone else is told it is not there.
  function noteAccess(taskId, me, writing) {
    const task = repos.tasks.findAnyById(taskId);
    const shared = task ? access.forTask(taskId, me) : null;
    if (!task || (!shared && task.userId !== me)) throw new HttpError(404, "Task not found", "task_not_found");
    return writing ? access.writeAs(shared, me) : access.readAs(shared, me);
  }

  router.get("/:id/notes", (req, res, next) => {
    try {
      noteAccess(req.params.id, req.auth.userId, false);
      res.json({ notes: repos.taskNotes.list(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/notes", (req, res, next) => {
    try {
      const { body } = z.object({ body: z.string().trim().min(1).max(20000) }).parse(req.body ?? {});
      noteAccess(req.params.id, req.auth.userId, true);
      const note = repos.taskNotes.create({ taskId: req.params.id, userId: req.auth.userId, body });
      res.status(201).json({ note });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "A note needs some text", "invalid_note"));
        return;
      }
      next(error);
    }
  });

  router.delete("/:id/notes/:noteId", (req, res, next) => {
    try {
      const ownerId = noteAccess(req.params.id, req.auth.userId, true);
      const note = repos.taskNotes.find(req.params.noteId);
      if (!note || note.taskId !== req.params.id) throw new HttpError(404, "Note not found", "note_not_found");
      if (note.userId !== req.auth.userId && ownerId !== req.auth.userId) {
        throw new HttpError(403, "Only the author can remove this note", "access_denied");
      }
      repos.taskNotes.remove(note.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", (req, res, next) => {
    (async () => {
      const { deviceId } = req.auth;
      const input = await updateSchema.parseAsync(req.body ?? {});
      const userId = access.writeAs(access.forTask(req.params.id, req.auth.userId), req.auth.userId);
      if (input.assigneeId) {
        const listId = input.listId ?? repos.tasks.findAnyById(req.params.id)?.listId;
        if (!listId || !access.isMember(listId, input.assigneeId)) {
          throw new HttpError(400, "Assignee is not on this list", "invalid_assignee");
        }
      }

      // Checking off a repeating task moves it to its next occurrence and
      // keeps it open (Reminders behaviour), so every client sees the advance.
      let data = input;
      if (input.isDone === true && input.dueAt === undefined) {
        const current = repos.tasks.findById({ userId, id: req.params.id });
        if (
          current &&
          !current.isDone &&
          current.dueAt !== null &&
          isRepeating(current.recurrence)
        ) {
          const dueAt = nextDueAt(current.dueAt, current.recurrence);
          const shift = dueAt - current.dueAt;
          data = {
            ...input,
            isDone: false,
            dueAt,
            remindAt:
              current.remindAt === null ? null : current.remindAt + shift,
          };
        }
      }

      const previousAssignee = repos.tasks.findAnyById(req.params.id)?.assigneeId ?? null;
      const task = repos.tasks.update({
        userId,
        id: req.params.id,
        deviceId,
        data,
      });
      if (task && task.assigneeId !== previousAssignee) notifyAssignee(task, req.auth.userId);

      if (!task) {
        throw new HttpError(404, "Task not found", "task_not_found");
      }

      // Deleting a task takes its subtasks with it.
      if (typeof input.deletedAt === "number" && input.deletedAt > 0) {
        const children = repos.tasks.list({
          userId,
          listId: null,
          parentId: task.id,
          includeDeleted: false,
        });
        for (const child of children) {
          repos.tasks.update({
            userId,
            id: child.id,
            deviceId,
            data: { deletedAt: input.deletedAt },
          });
        }
      }

      res.json({ task });
    })().catch((error) => {
      if (error instanceof HttpError) {
        next(error);
        return;
      }
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid request body", "invalid_body"));
        return;
      }
      next(error);
    });
  });

  return router;
}
