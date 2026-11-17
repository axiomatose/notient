/**
 * Component: Lucide icon routes (shape paths + name search)
 * Documentation: documentation/frontend/pages/tasks/tasks.md
 */
import { Router } from "express";
import { z } from "zod";
import { lucideShapes, searchLucideIcons } from "../lib/lucide.js";

const searchSchema = z.object({
  q: z.string().max(48).optional(),
});

export function createLucideRouter({ requireAuth }) {
  const router = Router();

  router.get("/lucide/:name", requireAuth, (req, res) => {
    const paths = lucideShapes(req.params.name);
    if (!paths) {
      res.status(404).json({ error: "icon_not_found" });
      return;
    }
    res.json({ name: req.params.name, paths });
  });

  router.get("/lucide-search", requireAuth, (req, res, next) => {
    try {
      const query = searchSchema.parse(req.query ?? {});
      res.json({ names: searchLucideIcons(query.q ?? "") });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
