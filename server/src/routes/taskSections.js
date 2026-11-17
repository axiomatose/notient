import { Router } from "express";
import { z } from "zod";
import { createListAccess } from "../lib/listAccess.js";
import { nanoid } from "nanoid";
import { HttpError } from "../errors.js";

const querySchema = z.object({
  includeDeleted: z
    .string()
    .transform((value) => value.toLowerCase() === "true")
    .optional(),
  listId: z.string().trim().min(1).optional(),
  since: z
    .string()
    .transform((value) => Number(value))
    .pipe(z.number().nonnegative())
    .optional(),
});

const createSchema = z.object({
  id: z.string().trim().min(10).max(64).optional(),
  listId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  icon: z.string().trim().max(32).optional(),
  color: z.string().trim().max(32).optional(),
  sortOrder: z.number().finite().optional(),
});

const updateSchema = z
  .object({
    listId: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    icon: z.string().trim().max(32).optional(),
    color: z.string().trim().max(32).optional(),
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

export function createTaskSectionsRouter({ repos, requireAuth }) {
  const router = Router();
  const access = createListAccess(repos);

  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      const query = querySchema.parse(req.query ?? {});
      const { userId: me } = req.auth;
      // A list shared with me is read as its owner's.
      const userId = access.readAs(access.forList(query.listId, me), me);

      if (query.since !== undefined) {
        const sections = repos.taskSections.listSince({
          userId,
          since: query.since,
        });
        res.json({ sections, since: query.since, count: sections.length });
        return;
      }

      const sections = repos.taskSections.list({
        userId,
        listId: query.listId,
        includeDeleted: query.includeDeleted ?? false,
      });
      res.json({ sections, count: sections.length });
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

      const timestamp = Date.now();
      const data = {
        ...input,
        id: input.id ?? nanoid(),
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };

      const section = repos.taskSections.create({
        userId,
        deviceId,
        data,
      });

      res.status(201).json({ section });
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
      const { deviceId } = req.auth;
      const input = await updateSchema.parseAsync(req.body ?? {});
      const userId = access.writeAs(access.forSection(req.params.id, req.auth.userId), req.auth.userId);

      const section = repos.taskSections.update({
        userId,
        id: req.params.id,
        deviceId,
        data: input,
      });

      if (!section) {
        throw new HttpError(
          404,
          "Task section not found",
          "task_section_not_found",
        );
      }

      res.json({ section });
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
