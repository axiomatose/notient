import { Router } from "express";
import { ZipArchive } from "archiver";
import multer from "multer";
import AdmZip from "adm-zip";
import { marked } from "marked";
import { nanoid } from "nanoid";
import { join } from "node:path";
import { existsSync, createReadStream } from "node:fs";

const upload = multer({ storage: multer.memoryStorage() });

export function createImportExportRouter({ repos, requireAuth, config }) {
  const router = Router();
  router.use(requireAuth);

  router.get("/export", async (req, res) => {
    try {
      const { userId } = req.auth;
      const notes = repos.notes.list({ userId, includeDeleted: false });

      res.attachment("notes_export.zip");
      const archive = new ZipArchive({
        zlib: { level: 9 },
      });

      archive.pipe(res);

      const usedNames = new Set();

      for (const note of notes) {
        // Construct filename
        let filename = (note.title || "Untitled").replace(/[^a-z0-9_\-\.]/gi, "_");
        if (filename.length === 0) filename = "Untitled";
        
        let finalName = filename;
        let counter = 1;
        while (usedNames.has(finalName)) {
          finalName = `${filename}_${counter}`;
          counter++;
        }
        usedNames.add(finalName);

        // Read file directly from FS to avoid HTML conversion
        if (config.notesDir) {
           const filePath = join(config.notesDir, userId, `${note.id}.md`);
           if (existsSync(filePath)) {
             archive.file(filePath, { name: `${finalName}.md` });
           } else {
             // If file missing (shouldn't happen), assume empty or database only?
             // Maybe write a text buffer?
             archive.append("", { name: `${finalName}.md` });
           }
        }
      }

      await archive.finalize();
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "export_failed" });
    }
  });

  router.post("/import", upload.single("file"), async (req, res) => {
    try {
      const { userId } = req.auth;
      const { deviceId } = req;
      
      if (!req.file) {
        return res.status(400).json({ error: "no_file" });
      }

      let importedCount = 0;
      const filename = req.file.originalname;

      // Helper to process a single markdown string
      const processMarkdown = async (markdown, title) => {
        // Convert MD to HTML for the API contract
        // The repository will convert it back to MD for storage
        const html = await marked.parse(markdown);
        const timestamp = Date.now();
        
        await repos.notes.create({
          userId,
          deviceId: deviceId || "import",
          data: {
            title,
            body: html,
            isPinned: false,
            tags: [],
            folder: "Imported",
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
            id: nanoid(),
          }
        });
      };

      if (filename.toLowerCase().endsWith(".zip")) {
        const zip = new AdmZip(req.file.buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (entry.isDirectory || !entry.name.toLowerCase().endsWith(".md")) {
            continue;
          }

          const markdown = entry.getData().toString("utf8");
          const title = entry.name.replace(/\.md$/i, "");
          
          await processMarkdown(markdown, title);
          importedCount++;
        }
      } else if (filename.toLowerCase().endsWith(".md")) {
        const markdown = req.file.buffer.toString("utf8");
        const title = filename.replace(/\.md$/i, "");
        
        await processMarkdown(markdown, title);
        importedCount = 1;
      } else {
        return res.status(400).json({ error: "invalid_file_type" });
      }

      res.json({ success: true, count: importedCount });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "import_failed" });
    }
  });

  return router;
}
