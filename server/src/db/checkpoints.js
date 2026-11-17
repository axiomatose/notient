export function createCheckpointsRepository(db) {
  const selectStmt = db.prepare(`
    SELECT device_id, last_pull
    FROM checkpoints
    WHERE device_id = ?
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO checkpoints (device_id, last_pull)
    VALUES (@device_id, @last_pull)
    ON CONFLICT(device_id) DO UPDATE SET last_pull = excluded.last_pull
  `);

  return {
    find(deviceId) {
      return selectStmt.get(deviceId) || null;
    },
    update({ deviceId, timestamp }) {
      upsertStmt.run({ device_id: deviceId, last_pull: timestamp });
      return { deviceId, lastPull: timestamp };
    },
  };
}
