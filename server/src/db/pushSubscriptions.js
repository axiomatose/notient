
export function createPushSubscriptionsRepository(db) {
  const table = "push_subscriptions";

  const insertStmt = db.prepare(`
    INSERT INTO ${table} (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
    VALUES (@id, @userId, @endpoint, @p256dh, @auth, @createdAt, @updatedAt)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = excluded.updated_at,
      user_id = excluded.user_id
  `);

  const findByUserStmt = db.prepare(`
    SELECT * FROM ${table} WHERE user_id = ?
  `);

  const deleteByEndpointStmt = db.prepare(`
    DELETE FROM ${table} WHERE endpoint = ?
  `);

  const deleteByUserStmt = db.prepare(`
    DELETE FROM ${table} WHERE user_id = ?
  `);

  return {
    save(subscription) {
      const now = Date.now();
      return insertStmt.run({
        id: subscription.id,
        userId: subscription.userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        createdAt: now,
        updatedAt: now,
      });
    },

    findByUser(userId) {
      return findByUserStmt.all(userId).map(row => ({
        id: row.id,
        userId: row.user_id,
        endpoint: row.endpoint,
        keys: {
          p256dh: row.p256dh,
          auth: row.auth
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },

    deleteByEndpoint(endpoint) {
      return deleteByEndpointStmt.run(endpoint);
    },

    deleteByUser(userId) {
      return deleteByUserStmt.run(userId);
    }
  };
}
