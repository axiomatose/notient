import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { HttpError } from "../errors.js";

const querySchema = z.object({
  includeDeleted: z
    .string()
    .transform((value) => value.toLowerCase() === "true")
    .optional(),
  since: z
    .string()
    .transform((value) => Number(value))
    .pipe(z.number().nonnegative())
    .optional(),
});

const createSchema = z.object({
  id: z.string().trim().min(10).max(64).optional(),
  name: z.string().trim().min(1),
  icon: z.string().trim().max(32).optional(),
  color: z.string().trim().max(32).optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
  groceryMode: z.boolean().optional(),
  viewMode: z.enum(["list", "board"]).nullable().optional(),
  sortOrder: z.number().finite().optional(),
});

const updateSchema = z
  .object({
    name: z.string().optional(),
    icon: z.string().max(32).optional(),
    color: z.string().max(32).optional(),
    folderId: z.string().trim().min(1).nullable().optional(),
    uncategorizedName: z.string().trim().max(80).optional(),
    groceryMode: z.boolean().optional(),
    viewMode: z.enum(["list", "board"]).nullable().optional(),
    sortOrder: z.number().finite().optional(),
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

export function createTaskListsRouter({ repos, requireAuth }) {
  const router = Router();

  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      const query = querySchema.parse(req.query ?? {});
      const { userId } = req.auth;

      if (query.since !== undefined) {
        const lists = repos.taskLists.listSince({
          userId,
          since: query.since,
        });
        res.json({ lists, since: query.since, count: lists.length });
        return;
      }

      const lists = repos.taskLists.list({
        userId,
        includeDeleted: query.includeDeleted ?? false,
      });
      res.json({ lists, count: lists.length });
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
      const { userId, deviceId } = req.auth;
      const input = await createSchema.parseAsync(req.body ?? {});

      const timestamp = Date.now();
      const data = {
        ...input,
        id: input.id ?? nanoid(),
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };

      const list = repos.taskLists.create({
        userId,
        deviceId,
        data,
      });

      res.status(201).json({ list });
    })().catch((error) => {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid request body", "invalid_body"));
        return;
      }
      next(error);
    });
  });

  router.patch("/:id", (req, res, next) => {
    (async () => {
      const { userId, deviceId } = req.auth;
      const input = await updateSchema.parseAsync(req.body ?? {});

      const list = repos.taskLists.update({
        userId,
        id: req.params.id,
        deviceId,
        data: input,
      });

      if (!list) {
        throw new HttpError(404, "Task list not found", "task_list_not_found");
      }

      res.json({ list });
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
