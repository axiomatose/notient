export function createUserRepository(db) {
  const insertUserStmt = db.prepare(`
    INSERT INTO users (id, email, display_name, password_hash, created_at)
    VALUES (@id, @email, @display_name, @password_hash, @created_at)
  `);

  const selectByEmailStmt = db.prepare(`
    SELECT id, email, password_hash, created_at, display_name, avatar_mime, avatar_updated_at, avatar_url
    FROM users
    WHERE email = ?
  `);

  const selectByIdStmt = db.prepare(`
    SELECT id, email, password_hash, created_at, display_name, avatar_mime, avatar_updated_at, avatar_url
    FROM users
    WHERE id = ?
  `);

  const selectProfileStmt = db.prepare(`
    SELECT
      id,
      email,
      created_at,
      display_name,
      avatar_blob,
      avatar_mime,
      avatar_updated_at,
      avatar_url,
      avatar_icon,
      avatar_color
    FROM users
    WHERE id = ?
  `);

  const updatePasswordHashStmt = db.prepare(`
    UPDATE users
    SET password_hash = @password_hash
    WHERE id = @id
  `);

  const updateAvatarIconColorStmt = db.prepare(`
    UPDATE users
    SET
      avatar_icon = CASE WHEN @set_icon THEN @avatar_icon ELSE avatar_icon END,
      avatar_color = CASE WHEN @set_color THEN @avatar_color ELSE avatar_color END
    WHERE id = @id
  `);

  const updateDisplayNameStmt = db.prepare(`
    UPDATE users
    SET display_name = @display_name
    WHERE id = @id
  `);

  const updateAvatarUrlStmt = db.prepare(`
    UPDATE users
    SET
      avatar_url = @avatar_url,
      avatar_mime = @avatar_mime,
      avatar_updated_at = @avatar_updated_at
    WHERE id = @id
  `);

  const updateAvatarBlobStmt = db.prepare(`
    UPDATE users
    SET
      avatar_blob = @avatar_blob,
      avatar_mime = @avatar_mime,
      avatar_updated_at = @avatar_updated_at
    WHERE id = @id
  `);

  const clearAvatarStmt = db.prepare(`
    UPDATE users
    SET
      avatar_url = NULL,
      avatar_blob = NULL,
      avatar_mime = NULL,
      avatar_updated_at = NULL
    WHERE id = @id
  `);

  const updateProfileTx = db.transaction(({ id, displayName, avatarIcon, avatarColor, avatar }) => {
    if (displayName !== undefined) {
      updateDisplayNameStmt.run({
        id,
        display_name: displayName,
      });
    }

    if (avatarIcon !== undefined || avatarColor !== undefined) {
      updateAvatarIconColorStmt.run({
        id,
        set_icon: avatarIcon !== undefined ? 1 : 0,
        avatar_icon: avatarIcon ?? null,
        set_color: avatarColor !== undefined ? 1 : 0,
        avatar_color: avatarColor ?? null,
      });
    }

    if (avatar === undefined) {
      return;
    }

    if (avatar === null) {
      clearAvatarStmt.run({ id });
      return;
    }

    // Support both URL and blob-based avatars
    if (avatar.url) {
      updateAvatarUrlStmt.run({
        id,
        avatar_url: avatar.url,
        avatar_mime: avatar.mimeType,
        avatar_updated_at: Date.now(),
      });
    } else if (avatar.buffer) {
      updateAvatarBlobStmt.run({
        id,
        avatar_blob: avatar.buffer,
        avatar_mime: avatar.mimeType,
        avatar_updated_at: Date.now(),
      });
    }
  });

  return {
    create(user) {
      insertUserStmt.run(user);
      return { ...user };
    },
    findByEmail(email) {
      return selectByEmailStmt.get(email) || null;
    },
    findById(id) {
      return selectByIdStmt.get(id) || null;
    },
    getProfile(id) {
      return selectProfileStmt.get(id) || null;
    },
    updateProfile({ id, displayName, avatarIcon, avatarColor, avatar }) {
      updateProfileTx({
        id,
        displayName:
          displayName !== undefined ? (displayName ?? null) : undefined,
        avatarIcon,
        avatarColor,
        avatar,
      });
    },
    updatePasswordHash(id, passwordHash) {
      updatePasswordHashStmt.run({ id, password_hash: passwordHash });
    },
    clearAvatarUrl(id) {
      clearAvatarStmt.run({ id });
    },
  };
}
