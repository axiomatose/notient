/**
 * Notification aggregation service
 * Combines task notifications and share notifications into a unified view
 */

export function createNotificationsHelper({ repos }) {
  return {
    /**
     * Get all notifications for a user (unified view)
     */
    async getAllNotifications(userId) {
      // Get task notifications
      const taskNotifications = await repos.taskNotifications.findByUserId(userId, {
        limit: 50,
        offset: 0,
        unreadOnly: false,
      });

      // Get unread note shares
      const noteShares = await repos.noteShares.findSharedWithUser(userId);
      const unreadNoteShares = noteShares.filter(share => !share.isRead);

      // Get unread task list shares
      const listShares = await repos.taskListShares.findSharedWithUser(userId);
      const unreadListShares = listShares.filter(share => !share.isRead);

      // Get unread task shares
      const taskShares = await repos.taskShares.findSharedWithUser(userId);
      const unreadTaskShares = taskShares.filter(share => !share.isRead);

      // Transform task notifications
      const taskNotifs = taskNotifications.map(tn => ({
        id: tn.id,
        type: tn.type === 'due_date' ? 'task_due' : `task_${tn.type}`,
        title: getTaskNotificationTitle(tn),
        message: getTaskNotificationMessage(tn),
        isRead: tn.isRead,
        createdAt: tn.createdAt,
        resourceId: tn.taskId,
        resourceType: 'task',
        listId: tn.payload?.listId ?? null,
      }));

      // Transform note shares
      const noteNotifs = unreadNoteShares.map(share => ({
        id: share.id,
        type: 'note_shared',
        title: 'Note shared with you',
        message: `${share.sharedByUserEmail || 'Someone'} shared a note with you`,
        isRead: share.isRead || false,
        createdAt: share.createdAt,
        resourceId: share.noteId,
        resourceType: 'note',
      }));

      // Transform list shares
      const listNotifs = unreadListShares.map(share => ({
        id: share.id,
        type: 'list_shared',
        title: 'Task list shared with you',
        message: `${share.sharedByUserEmail || 'Someone'} shared a task list with you`,
        isRead: share.isRead || false,
        createdAt: share.createdAt,
        resourceId: share.listId,
        resourceType: 'task_list',
      }));

      // Transform task shares
      const taskShareNotifs = unreadTaskShares.map(share => ({
        id: share.id,
        type: 'task_shared',
        title: 'Task shared with you',
        message: `${share.sharedByUserEmail || 'Someone'} shared a task with you`,
        isRead: share.isRead || false,
        createdAt: share.createdAt,
        resourceId: share.taskId,
        resourceType: 'task',
      }));

      // Combine and sort by creation date (newest first)
      const allNotifications = [
        ...taskNotifs,
        ...noteNotifs,
        ...listNotifs,
        ...taskShareNotifs,
      ].sort((a, b) => b.createdAt - a.createdAt);

      return allNotifications;
    },

    /**
     * Mark all notifications as read for a user
     */
    async markAllAsRead(userId) {
      // Mark all task notifications as read
      await repos.taskNotifications.markAllAsRead(userId);

      // Mark all note shares as read
      const noteShares = await repos.noteShares.findSharedWithUser(userId);
      for (const share of noteShares) {
        if (!share.isRead) {
          await repos.noteShares.markAsRead(share.id);
        }
      }

      // Mark all list shares as read
      const listShares = await repos.taskListShares.findSharedWithUser(userId);
      for (const share of listShares) {
        if (!share.isRead) {
          await repos.taskListShares.markAsRead(share.id);
        }
      }

      // Mark all task shares as read
      const taskShares = await repos.taskShares.findSharedWithUser(userId);
      for (const share of taskShares) {
        if (!share.isRead) {
          await repos.taskShares.markAsRead(share.id);
        }
      }

      return { success: true };
    },
  };
}

function getTaskNotificationTitle(taskNotification) {
  switch (taskNotification.type) {
    case 'due':
    case 'due_date':
      return 'Task due today';
    case 'reminder':
      return 'Task reminder';
    case 'overdue':
      return 'Task overdue';
    case 'assigned':
      return 'Task assigned to you';
    default:
      return 'Task notification';
  }
}

function getTaskNotificationMessage(taskNotification) {
  const taskTitle = taskNotification.payload?.taskTitle || 'A task';
  const listName = taskNotification.payload?.listName || '';
  
  switch (taskNotification.type) {
    case 'due':
    case 'due_date':
      return `${taskTitle} is due today${listName ? ` in ${listName}` : ''}`;
    case 'reminder':
      return `Reminder: ${taskTitle}${listName ? ` in ${listName}` : ''}`;
    case 'overdue':
      return `${taskTitle} is overdue${listName ? ` in ${listName}` : ''}`;
    case 'assigned':
      return `${taskNotification.payload?.byName || 'Someone'} assigned you ${taskTitle}${listName ? ` in ${listName}` : ''}`;
    default:
      return taskTitle;
  }
}
