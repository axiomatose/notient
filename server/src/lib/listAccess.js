/**
 * Component: Shared task list access
 * Documentation: documentation/backend/collaboration.md
 *
 * Who may read or change the tasks and sections of a list: its owner, and the people it is shared with
 * (permission view: read; edit or admin: read and write). Records stay owned by the list's owner, so every
 * reader sees the same rows; callers query and write as `ownerId`.
 */
import { HttpError } from "../errors.js";

const WRITE = new Set(["edit", "admin"]);

export function createListAccess(repos) {
  function forList(listId, userId) {
    if (!listId) return null;
    const list = repos.taskLists.findByIdOnly(listId);
    if (!list) return null;
    if (list.userId === userId) return { owner: true, ownerId: userId, write: true };
    const permission = repos.taskListShares.canUserAccessList(listId, userId);
    if (!permission) return null;
    return { owner: false, ownerId: list.userId, write: WRITE.has(permission) };
  }

  /** The people on a list: its owner and everyone it is shared with. */
  function members(listId) {
    const list = repos.taskLists.findByIdOnly(listId);
    if (!list) return [];
    const person = (id, role) => {
      const u = repos.users.getProfile(id) ?? repos.users.findById(id);
      return u
        ? {
            id,
            role,
            email: u.email,
            displayName: u.displayName ?? u.display_name ?? null,
            avatarIcon: u.avatarIcon ?? u.avatar_icon ?? null,
            avatarColor: u.avatarColor ?? u.avatar_color ?? null,
            avatarUrl: u.avatarUrl ?? u.avatar_url ?? null,
            avatarUpdatedAt: u.avatarUpdatedAt ?? u.avatar_updated_at ?? null,
          }
        : null;
    };
    const shares = repos.taskListShares.findByListId(listId) ?? [];
    return [person(list.userId, "owner"), ...shares.map((s) => person(s.sharedWithUserId, s.permission))].filter(Boolean);
  }

  return {
    forList,
    members,
    /** True when `assigneeId` is the list's owner or someone it is shared with. */
    isMember(listId, assigneeId) {
      return members(listId).some((m) => m.id === assigneeId);
    },
    forTask(taskId, userId) {
      const task = repos.tasks.findAnyById(taskId);
      return task ? forList(task.listId, userId) : null;
    },
    forSection(sectionId, userId) {
      const section = repos.taskSections.findAnyById(sectionId);
      return section ? forList(section.listId, userId) : null;
    },
    /** The user to query as: the list's owner when the list is shared with `userId`, else `userId`. */
    readAs(access, userId) {
      return access && !access.owner ? access.ownerId : userId;
    },
    /** The user to write as; refuses a read-only share. */
    writeAs(access, userId) {
      if (!access || access.owner) return userId;
      if (!access.write) {
        throw new HttpError(403, "This list is shared read-only", "read_only_list");
      }
      return access.ownerId;
    },
  };
}
