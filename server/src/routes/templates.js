/**
 * Component: Templates routes
 * Documentation: documentation/backend/database.md
 *
 * GET /templates -> {templates}; POST /templates {kind, name, payload}; DELETE /templates/:id. Private to their owner.
 */
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";

const taskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  section: z.number().int().min(-1).max(100).default(-1),
  priority: z.number().int().min(0).max(3).default(0),
  flagged: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  subtasks: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  icon: z.string().trim().max(32).default(""),
  color: z.string().trim().max(32).default(""),
});

const notePayload = z.object({ title: z.string().max(500).default(""), body: z.string().max(200000).default("") });
const listPayload = z.object({
  icon: z.string().trim().max(32).default(""),
  color: z.string().trim().max(32).default(""),
  sections: z.array(sectionSchema).max(30).default([]),
  tasks: z.array(taskSchema).max(300).default([]),
});

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), name: z.string().trim().min(1).max(100), payload: notePayload }),
  z.object({ kind: z.literal("list"), name: z.string().trim().min(1).max(100), payload: listPayload }),
]);

export function createTemplatesRouter({ repos, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      res.json({ templates: repos.templates.list(req.auth.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const input = createSchema.parse(req.body ?? {});
      res.status(201).json({ template: repos.templates.create({ userId: req.auth.userId, ...input }) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "That template is not valid", "invalid_template"));
        return;
      }
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      if (!repos.templates.remove(req.params.id, req.auth.userId)) throw new HttpError(404, "Template not found", "template_not_found");
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
