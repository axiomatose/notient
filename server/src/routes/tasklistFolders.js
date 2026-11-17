import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";

const querySchema = z.object({
  since: z
    .string()
    .transform((value) => Number(value))
    .pipe(z.number().nonnegative())
    .optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(32).optional(),
  sortOrder: z.number().finite().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    color: z.string().max(32).optional(),
    icon: z.string().max(32).optional(),
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

export function createTaskListFoldersRouter({ repos, requireAuth }) {
  const router = Router();

  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      const query = querySchema.parse(req.query ?? {});
      const { userId } = req.auth;

      if (query.since !== undefined) {
        const folders = repos.folders.getFoldersSince(userId, query.since);
        res.json({ folders, since: query.since, count: folders.length });
        return;
      }

      const folders = repos.folders.getAllFolders(userId);
      res.json({ folders, count: folders.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid query parameters", "invalid_query"));
        return;
      }
      next(error);
    }
  });

  router.get("/:id", (req, res, next) => {
    try {
      const folder = repos.folders.getFolderById(req.auth.userId, req.params.id);

      if (!folder || folder.userId !== req.auth.userId) {
        throw new HttpError(404, "Folder not found", "folder_not_found");
      }

      res.json({ folder });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
    (async () => {
      const { userId } = req.auth;
      const input = await createSchema.parseAsync(req.body ?? {});

      const folder = repos.folders.create(userId, {
        ...input,
      });

      res.status(201).json({ folder });
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
      const { userId } = req.auth;
      const input = await updateSchema.parseAsync(req.body ?? {});
      
      const existing = repos.folders.getFolderById(userId, req.params.id);
      if (!existing || existing.userId !== userId) {
        throw new HttpError(404, "Folder not found", "folder_not_found");
      }

      const folder = repos.folders.update(userId, req.params.id, input);

      res.json({ folder });
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

  router.delete("/:id", (req, res, next) => {
    try {
      const { userId } = req.auth;
      
      const existing = repos.folders.getFolderById(userId, req.params.id);
      if (!existing || existing.userId !== userId) {
        throw new HttpError(404, "Folder not found", "folder_not_found");
      }

      repos.folders.softDelete(userId, req.params.id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}