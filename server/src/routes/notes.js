import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { ZipArchive } from "archiver";
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

const folderSchema = z.union([z.string().max(120), z.null()]).optional();

function normalizeFolder(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const createSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1),
  body: z.string().optional(),
  bodyMarkdown: z.string().optional(),
  isPinned: z.boolean().optional(),
  tags: z.array(z.string().trim()).optional(),
  folder: folderSchema,
});

const updateSchema = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    bodyMarkdown: z.string().optional(),
    isPinned: z.boolean().optional(),
    tags: z.array(z.string().trim()).optional(),
    deletedAt: z.number().nonnegative().nullable().optional(),
    folder: folderSchema,
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

// Export: a note as "# Title" plus its body, so the title survives a round trip through import.
const safeName = (value, fallback) => {
  const n = String(value ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 100);
  return n === "" || n === "." || n === ".." ? fallback : n;
};
const exportText = (note) => {
  const title = String(note.title ?? "").trim();
  const body = String(note.bodyMarkdown ?? "");
  return title === "" ? body : `# ${title}\n\n${body.replace(/^\n+/, "")}`;
};
const inFolder = (folder, root) => {
  const f = String(folder ?? "");
  return f === root || f.startsWith(`${root}/`);
};

export function createNotesRouter({ repos, requireAuth }) {
  const router = Router();

  router.use(requireAuth);

  router.get("/", (req, res, next) => {
    try {
      const query = querySchema.parse(req.query ?? {});
      const { userId } = req.auth;

      if (query.since !== undefined) {
        const notes = repos.notes.listSince({
          userId,
          since: query.since,
        });
        res.json({ notes, since: query.since, count: notes.length });
        return;
      }

      const notes = repos.notes.list({
        userId,
        includeDeleted: query.includeDeleted ?? false,
      });
      res.json({ notes, count: notes.length });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid query parameters", "invalid_query"));
        return;
      }
      next(error);
    }
  });

  // Export: the library or one folder (with its subfolders) as a zip laid out like the folders, or one note as a file.
  router.get("/export", (req, res, next) => {
    try {
      const { userId } = req.auth;
      const folder = typeof req.query.folder === "string" ? req.query.folder.trim() : "";
      const mine = repos.notes.list({ userId, includeDeleted: false }).filter((n) => n.userId === userId);
      const picked = folder === "" ? mine : mine.filter((n) => inFolder(n.folder, folder));
      const label = safeName(folder === "" ? "Notient notes" : folder.split("/").at(-1), "Notient notes");
      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename="${label}.zip"`);
      const zip = new ZipArchive({ zlib: { level: 6 } });
      zip.on("error", next);
      zip.pipe(res);
      const used = new Set();
      for (const n of picked) {
        const dir = String(n.folder ?? "")
          .split("/")
          .map((p) => safeName(p, ""))
          .filter((p) => p !== "")
          .join("/");
        const base = safeName(n.title, "Untitled");
        let name = `${dir === "" ? "" : `${dir}/`}${base}`;
        for (let k = 2; used.has(name.toLowerCase()); k++) name = `${dir === "" ? "" : `${dir}/`}${base} (${k})`;
        used.add(name.toLowerCase());
        zip.append(exportText(n), { name: `${name}.md`, date: new Date(n.updatedAt || Date.now()) });
      }
      zip.finalize();
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/export", (req, res, next) => {
    try {
      const { userId } = req.auth;
      const note = repos.notes.findById({ userId, id: req.params.id });
      if (!note) {
        next(new HttpError(404, "Note not found", "note_not_found"));
        return;
      }
      res.setHeader("content-type", "text/markdown; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${safeName(note.title, "Untitled")}.md"`);
      res.send(exportText(note));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", (req, res, next) => {
    try {
      const { userId } = req.auth;
      const note = repos.notes.findById({ userId, id: req.params.id });
      if (!note) {
        next(new HttpError(404, "Note not found", "note_not_found"));
        return;
      }
      res.json({ note });
    } catch (error) {
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
        folder: normalizeFolder(input.folder),
        id: input.id ?? nanoid(),
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };

      const note = repos.notes.create({
        userId,
        deviceId,
        data,
      });

      res.status(201).json({ note });
    })().catch((error) => {
      if (error instanceof z.ZodError) {
        console.error("Notes POST validation error:", JSON.stringify(error.format(), null, 2));
        next(new HttpError(400, `Invalid request body: ${JSON.stringify(error.format())}`, "invalid_body"));
        return;
      }
      next(error);
    });
  });

  router.patch("/:id", (req, res, next) => {
    (async () => {
      const { userId, deviceId } = req.auth;
      const input = await updateSchema.parseAsync(req.body ?? {});

      const note = repos.notes.update({
        userId,
        id: req.params.id,
        deviceId,
        data: {
          ...input,
          folder: input.folder === undefined ? undefined : normalizeFolder(input.folder),
          updatedAt: input.deletedAt !== undefined ? Date.now() : undefined,
        },
      });

      if (!note) {
        throw new HttpError(404, "Note not found", "note_not_found");
      }

      res.json({ note });
    })().catch((error) => {
      if (error instanceof HttpError) {
        next(error);
        return;
      }
      if (error instanceof z.ZodError) {
        console.error("Notes PATCH validation error:", JSON.stringify(error.format(), null, 2));
        next(new HttpError(400, `Invalid request body: ${JSON.stringify(error.format())}`, "invalid_body"));
        return;
      }
      next(error);
    });
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const { userId } = req.auth;
      const success = repos.notes.deletePermanently({
        userId,
        id: req.params.id,
      });

      if (!success) {
        throw new HttpError(404, "Note not found", "note_not_found");
      }

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
