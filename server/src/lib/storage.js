/**
 * Local file storage for uploaded images (avatars, notes, tasks, backgrounds).
 * Documentation: documentation/exact-migration.md
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import logger from "../utils/logger.js";

export function createFileStorage({ dataDir, publicUrl }) {
  const rootDir = join(dataDir, "uploads");
  const baseUrl = `${publicUrl.replace(/\/$/, "")}/files`;

  function pathFor(key) {
    const path = resolve(rootDir, key);
    if (path !== rootDir && !path.startsWith(rootDir + "/")) {
      throw new Error("Invalid storage key");
    }
    return path;
  }

  function getPublicUrl(key) {
    return `${baseUrl}/${key}`;
  }

  async function uploadFile(key, buffer) {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return getPublicUrl(key);
  }

  async function deleteFile(key) {
    try {
      await rm(pathFor(key));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return {
    getPublicUrl,
    uploadFile,
    deleteFile,
    pathFor,

    getProfileImageUrl(userId) {
      return getPublicUrl(`profiles/${userId}/avatar.jpg`);
    },

    async uploadProfileImage(userId, buffer, mimeType) {
      const url = await uploadFile(`profiles/${userId}/avatar.jpg`, buffer);
      logger.info("Profile upload successful", { url, mimeType });
      return url;
    },

    deleteProfileImage(userId) {
      return deleteFile(`profiles/${userId}/avatar.jpg`);
    },

    uploadNoteImage(noteId, filename, buffer) {
      return uploadFile(`notes/${noteId}/${filename}`, buffer);
    },

    deleteNoteImage(noteId, filename) {
      return deleteFile(`notes/${noteId}/${filename}`);
    },

    uploadTaskImage(filename, buffer) {
      return uploadFile(`tasks/${filename}`, buffer);
    },

    deleteTaskImage(filename) {
      return deleteFile(`tasks/${filename}`);
    },

    async uploadBackgroundImage(filename, buffer) {
      const url = await uploadFile(`backgrounds/${filename}`, buffer);
      return { url, uploadedAt: Date.now() };
    },

    deleteBackgroundImage(filename) {
      return deleteFile(`backgrounds/${filename}`);
    },
  };
}
