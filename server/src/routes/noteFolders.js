/**
 * Component: Note folders routes
 * Documentation: documentation/backend/database.md
 *
 * GET /note-folders -> {folders: string[]}; POST /note-folders {name, parent?} -> {path}. The path is "parent/name".
 * DELETE /note-folders?path=A/B -> 204; 409 folder_not_empty while a note is in it or below it (empty subfolders go too).
 */
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";

const segment = z.string().trim().min(1).max(100).refine((s) => !s.includes("/") && s !== "." && s !== "..", "no slash");
const createSchema = z.object({
  name: segment,
  parent: z.string().trim().max(400).default(""),
});

export function createNoteFoldersRouter({ repos, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      res.json({ folders: repos.noteFolders.list(req.auth.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const input = createSchema.parse(req.body ?? {});
      const parent = input.parent.split("/").map((p) => p.trim()).filter((p) => p !== "");
      if (parent.some((p) => p === "." || p === "..")) throw new HttpError(400, "That folder is not valid", "invalid_folder");
      const path = [...parent, input.name].join("/");
      repos.noteFolders.add(req.auth.userId, path);
      res.status(201).json({ path });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "That folder is not valid", "invalid_folder"));
        return;
      }
      next(error);
    }
  });

  router.delete("/", (req, res, next) => {
    try {
      const path = String(req.query.path ?? "").split("/").map((p) => p.trim()).filter((p) => p !== "");
      if (path.length === 0 || path.some((p) => p === "." || p === "..")) throw new HttpError(400, "That folder is not valid", "invalid_folder");
      if (!repos.noteFolders.removeEmpty(req.auth.userId, path.join("/"))) throw new HttpError(409, "That folder still has notes in it", "folder_not_empty");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
