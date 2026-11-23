import { Router } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { nanoid } from "nanoid";

const upload = multer({ storage: multer.memoryStorage() });

export function createImportExportRouter({ repos, requireAuth, config }) {
  const router = Router();
  router.use(requireAuth);

  // Export lives in routes/notes.js (GET /notes/export and /notes/:id/export), laid out like the folders.

  router.post("/import", upload.single("file"), async (req, res) => {
    try {
      const { userId } = req.auth;
      const { deviceId } = req;
      
      if (!req.file) {
        return res.status(400).json({ error: "no_file" });
      }

      let importedCount = 0;
      const filename = req.file.originalname;

      // One Markdown file becomes one note: the first "# Heading" is the title, else the file name. The text is kept
      // as written (no HTML round trip) and `folder` is the zip's directory path ("" for a single file).
      const processMarkdown = (markdown, name, folder) => {
        const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
        const m = /^(?:\s*\n)*#[ \t]+(.+?)[ \t#]*\n?/.exec(text);
        const title = (m && m[1].trim() !== "" ? m[1].trim() : name.replace(/\.(md|markdown)$/i, "").trim() || "Untitled").slice(0, 200);
        const body = m && m[1].trim() !== "" ? text.slice(m[0].length).replace(/^\n+/, "") : text;
        const timestamp = Date.now();
        repos.notes.create({
          userId,
          deviceId: deviceId || "import",
          data: {
            title,
            bodyMarkdown: body,
            isPinned: false,
            tags: [],
            ...(folder !== "" ? { folder } : {}),
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
            id: nanoid(),
          },
        });
      };

      if (filename.toLowerCase().endsWith(".zip")) {
        const zip = new AdmZip(req.file.buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (entry.isDirectory || !/\.(md|markdown)$/i.test(entry.name) || entry.name.startsWith(".") || entry.entryName.startsWith("__MACOSX/")) {
            continue;
          }
          const dirs = entry.entryName.split("/").slice(0, -1).filter((p) => p !== "" && p !== "." && p !== "..");
          processMarkdown(entry.getData().toString("utf8"), entry.name, dirs.join("/").slice(-120));
          importedCount++;
        }
      } else if (/\.(md|markdown)$/i.test(filename)) {
        processMarkdown(req.file.buffer.toString("utf8"), filename, "");
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
