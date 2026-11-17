import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../errors.js';

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

export function createPublicRouter({ repos }) {
  const router = Router();

  router.use(publicLimiter);

  // Public endpoint to get a shared note via shareable link
  router.get('/notes/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      
      // Find the shareable link
      const link = repos.shareableLinks.findBySlug(slug);
      if (!link) {
        throw new HttpError(404, 'Not found', 'link_not_found');
      }

      // Check if link is expired
      if (repos.shareableLinks.isExpired(link)) {
        throw new HttpError(410, 'Link expired', 'link_expired');
      }

      // Fetch the note content
      // Use findByIdOnly because public access has no user context
      const note = await repos.notes.findByIdOnly(link.resourceId);
      if (!note) {
        throw new HttpError(404, 'Note not found', 'note_not_found');
      }

      // Check if note is deleted
      if (note.deletedAt && note.deletedAt > 0) {
        throw new HttpError(410, 'Note deleted', 'note_deleted');
      }

      // Return JSON data
      res.json({
        type: 'note',
        title: note.title,
        content: note.body,
        bodyMarkdown: note.bodyMarkdown,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
      });

    } catch (error) {
      console.error('Public note view error:', error);
      next(error);
    }
  });

  // Public endpoint to get a shared task list via shareable link
  router.get('/task-lists/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      
      // Find the shareable link
      const link = repos.shareableLinks.findBySlug(slug);
      if (!link) {
        throw new HttpError(404, 'Not found', 'link_not_found');
      }

      // Check if link is expired
      if (repos.shareableLinks.isExpired(link)) {
        throw new HttpError(410, 'Link expired', 'link_expired');
      }

      // Fetch the task list
      // Use findByIdOnly because public access has no user context
      const taskList = await repos.taskLists.findByIdOnly(link.resourceId);
      if (!taskList) {
        throw new HttpError(404, 'Task list not found', 'task_list_not_found');
      }

      // Check if task list is deleted
      if (taskList.deletedAt && taskList.deletedAt > 0) {
        throw new HttpError(410, 'Task list deleted', 'task_list_deleted');
      }

      // Fetch tasks and sections for the list
      const tasks = await repos.tasks.findByListId(link.resourceId);
      const sections = await repos.taskSections.findByListId(link.resourceId);

      // Return JSON data
      res.json({
        type: 'task_list',
        title: taskList.name,
        tasks,
        sections,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
      });

    } catch (error) {
      console.error('Public task list view error:', error);
      next(error);
    }
  });

  return router;
}


