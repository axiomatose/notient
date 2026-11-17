import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import TurndownService from "turndown";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const db = new Database(config.dbPath);
const turndownService = new TurndownService();

// Configure turndown to keep some elements if needed, or use defaults
// For now defaults should cover most rich text from TipTap
turndownService.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: function (content) {
    return '~' + content + '~'
  }
});

console.log("Starting migration of notes to filesystem...");

// Get all notes with content
const notes = db.prepare("SELECT * FROM notes WHERE body != '' AND body IS NOT NULL").all();

console.log(`Found ${notes.length} notes to migrate.`);

let successCount = 0;
let errorCount = 0;

const updateStmt = db.prepare("UPDATE notes SET body = '' WHERE id = ?");

db.transaction(() => {
  for (const note of notes) {
    try {
      const { id, user_id, body } = note;
      const markdown = turndownService.turndown(body || "");
      
      const userDir = join(config.notesDir, user_id);
      if (!existsSync(userDir)) {
        mkdirSync(userDir, { recursive: true });
      }
      
      const filePath = join(userDir, `${id}.md`);
      writeFileSync(filePath, markdown, "utf8");
      
      updateStmt.run(id);
      successCount++;
      
      if (successCount % 10 === 0) {
        console.log(`Migrated ${successCount} notes...`);
      }
    } catch (error) {
      console.error(`Failed to migrate note ${note.id}:`, error);
      errorCount++;
    }
  }
})();

console.log("Migration complete.");
console.log(`Successfully migrated: ${successCount}`);
console.log(`Errors: ${errorCount}`);
