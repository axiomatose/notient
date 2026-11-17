import { Router } from "express";
import { HttpError } from "../errors.js";

export function createShareableLinksRouter({ repos, requireAuth }) {
  const router = Router();
  
  // Apply auth middleware to all routes
  router.use(requireAuth);

  // Get shareable links for a resource
  router.get("/resource/:resourceType/:resourceId", (req, res, next) => {
    try {
      const { resourceType, resourceId } = req.params;
      
      if (!['note', 'task_list'].includes(resourceType)) {
        throw new HttpError(400, "Invalid resource type", "invalid_resource_type");
      }

      // Verify user owns the resource
      let resource;
      if (resourceType === 'note') {
        resource = repos.notes.findById({ userId: req.auth.userId, id: resourceId });
      } else {
        resource = repos.taskLists.findById({ userId: req.auth.userId, id: resourceId });
      }

      if (!resource) {
        throw new HttpError(404, "Resource not found", "resource_not_found");
      }

      if (resource.userId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      const links = repos.shareableLinks.findByResource(resourceType, resourceId);
      res.json({ links });
    } catch (error) {
      next(error);
    }
  });

  // Get shareable links created by current user
  router.get("/my-links", (req, res, next) => {
    try {
      const links = repos.shareableLinks.findByCreatedByUserId(req.auth.userId);
      res.json({ links });
    } catch (error) {
      next(error);
    }
  });

  // Create a new shareable link
  router.post("/", (req, res, next) => {
    try {
      const { resourceType, resourceId, expiresAt } = req.body;
      
      if (!resourceType || !resourceId) {
        throw new HttpError(400, "Missing required fields", "missing_fields");
      }

      if (!['note', 'task_list'].includes(resourceType)) {
        throw new HttpError(400, "Invalid resource type", "invalid_resource_type");
      }

      // Verify user owns the resource
      let resource;
      if (resourceType === 'note') {
        // Only the owner can create shareable links
        resource = repos.notes.findById({ userId: req.auth.userId, id: resourceId });
        
        if (!resource) {
          // Check if note exists but user doesn't own it
          const noteExists = repos.notes.findByIdOnly(resourceId);
          if (noteExists) {
            throw new HttpError(403, "You can only create shareable links for resources you own", "not_owner");
          }
          throw new HttpError(404, "Note not found", "resource_not_found");
        }
      } else {
        resource = repos.taskLists.findById({ userId: req.auth.userId, id: resourceId });
        if (!resource) {
          const listExists = repos.taskLists.findByIdOnly(resourceId);
          if (listExists) {
            throw new HttpError(403, "You can only create shareable links for resources you own", "not_owner");
          }
          throw new HttpError(404, "Task list not found", "resource_not_found");
        }
      }

      // Generate a unique slug based on resource title
      const baseTitle = resourceType === 'note' ? resource.title : resource.name;
      const slug = repos.shareableLinks.generateUniqueSlug(baseTitle);

      // Create the shareable link
      const link = repos.shareableLinks.create({
        resourceType,
        resourceId,
        slug,
        createdByUserId: req.auth.userId,
        expiresAt: expiresAt || null,
      });

      res.status(201).json({ 
        link,
        url: `${process.env.APP_URL || 'http://localhost:5173'}/share/${resourceType}/${slug}`,
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete a shareable link
  router.delete("/:id", (req, res, next) => {
    try {
      const { id } = req.params;
      
      // Get the link
      const link = repos.shareableLinks.findById(id);
      if (!link) {
        throw new HttpError(404, "Shareable link not found", "link_not_found");
      }

      // Only the creator can delete the link
      if (link.createdByUserId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      repos.shareableLinks.delete(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
