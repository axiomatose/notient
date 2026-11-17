export function createDeviceRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO devices (id, user_id, name, last_seen)
    VALUES (@id, @user_id, @name, @last_seen)
  `);

  const updateLastSeenStmt = db.prepare(`
    UPDATE devices
    SET last_seen = @last_seen, name = COALESCE(@name, name)
    WHERE id = @id AND user_id = @user_id
  `);

  const selectByIdStmt = db.prepare(`
    SELECT id, user_id, name, last_seen
    FROM devices
    WHERE id = ?
  `);

  const deleteOldStmt = db.prepare(`
    DELETE FROM devices
    WHERE user_id = ? AND last_seen < ?
  `);

  return {
    create(device) {
      insertStmt.run(device);
      return { ...device };
    },
    findById(id) {
      return selectByIdStmt.get(id) || null;
    },
    touch({ id, userId, name, timestamp }) {
      const result = updateLastSeenStmt.run({
        id,
        user_id: userId,
        name,
        last_seen: timestamp,
      });
      return result.changes > 0;
    },
    purgeStale({ userId, cutoff }) {
      deleteOldStmt.run(userId, cutoff);
    },
  };
}
