import { nanoid } from 'nanoid';

export function createShareableLinksRepository(db) {
  return {
    create({ resourceType, resourceId, slug, createdByUserId, expiresAt }) {
      const id = `link-${nanoid(10)}`;
      const createdAt = Date.now();

      const stmt = db.prepare(`
        INSERT INTO shareable_links (id, resource_type, resource_id, slug, created_by_user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, resourceType, resourceId, slug, createdByUserId, expiresAt || null, createdAt);

      return this.findById(id);
    },

    findById(id) {
      const stmt = db.prepare(`
        SELECT 
          id,
          resource_type as resourceType,
          resource_id as resourceId,
          slug,
          created_by_user_id as createdByUserId,
          expires_at as expiresAt,
          created_at as createdAt
        FROM shareable_links
        WHERE id = ?
      `);

      return stmt.get(id);
    },

    findBySlug(slug) {
      const stmt = db.prepare(`
        SELECT 
          id,
          resource_type as resourceType,
          resource_id as resourceId,
          slug,
          created_by_user_id as createdByUserId,
          expires_at as expiresAt,
          created_at as createdAt
        FROM shareable_links
        WHERE slug = ?
      `);

      return stmt.get(slug);
    },

    findByResource(resourceType, resourceId) {
      const stmt = db.prepare(`
        SELECT 
          id,
          resource_type as resourceType,
          resource_id as resourceId,
          slug,
          created_by_user_id as createdByUserId,
          expires_at as expiresAt,
          created_at as createdAt
        FROM shareable_links
        WHERE resource_type = ? AND resource_id = ?
        ORDER BY created_at DESC
      `);

      return stmt.all(resourceType, resourceId);
    },

    findByCreatedByUserId(userId) {
      const stmt = db.prepare(`
        SELECT 
          id,
          resource_type as resourceType,
          resource_id as resourceId,
          slug,
          created_by_user_id as createdByUserId,
          expires_at as expiresAt,
          created_at as createdAt,
          CASE 
            WHEN resource_type = 'note' THEN (SELECT title FROM notes WHERE id = resource_id)
            WHEN resource_type = 'task_list' THEN (SELECT name FROM task_lists WHERE id = resource_id)
            ELSE NULL
          END as resourceTitle
        FROM shareable_links
        WHERE created_by_user_id = ?
        ORDER BY created_at DESC
      `);

      return stmt.all(userId);
    },

    isValidSlug(slug) {
      const link = this.findBySlug(slug);
      if (!link) {
        return false;
      }

      // Check if expired
      if (link.expiresAt && link.expiresAt < Date.now()) {
        return false;
      }

      return link;
    },

    isExpired(link) {
      if (!link.expiresAt) {
        return false;
      }
      return link.expiresAt < Date.now();
    },

    delete(id) {
      const stmt = db.prepare(`DELETE FROM shareable_links WHERE id = ?`);
      stmt.run(id);
    },

    deleteByResource(resourceType, resourceId) {
      const stmt = db.prepare(`
        DELETE FROM shareable_links 
        WHERE resource_type = ? AND resource_id = ?
      `);
      stmt.run(resourceType, resourceId);
    },

    generateUniqueSlug(baseSlug) {
      let slug = baseSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').substring(0, 50);
      let counter = 1;
      let uniqueSlug = slug;

      // Try up to 100 times to find a unique slug
      while (this.findBySlug(uniqueSlug) && counter < 100) {
        uniqueSlug = `${slug}-${counter}`;
        counter++;
      }

      // If we can't find a unique slug, use nanoid
      if (counter >= 100) {
        uniqueSlug = nanoid(10);
      }

      return uniqueSlug;
    },
  };
}
