/**
 * Component: Search routes
 * Documentation: documentation/backend/database.md
 *
 * GET /search?q=&limit= -> {notes, tasks, events}: the signed-in person's own items that match.
 */
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

export function createSearchRouter({ repos, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      const { q, limit } = querySchema.parse(req.query ?? {});
      res.json(repos.search.search({ userId: req.auth.userId, q, limit }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Search for something", "invalid_query"));
        return;
      }
      next(error);
    }
  });

  return router;
}
