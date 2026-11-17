/**
 * Component: Task recurrence (advance dueAt on completion)
 * Documentation: documentation/frontend/pages/tasks/tasks.md
 */

export const RECURRENCES = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];

const DAY_MS = 86400000;

// Stored as NULL for "none" so that unset and none are one state.
export function normalizeRecurrence(value) {
  return RECURRENCES.includes(value) && value !== "none" ? value : null;
}

export function isRepeating(recurrence) {
  return normalizeRecurrence(recurrence) !== null;
}

// Calendar months in UTC, clamping the day (Jan 31 + 1 month = Feb 28/29).
function addMonths(ms, months) {
  const base = new Date(ms);
  const target = new Date(ms);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return target.getTime();
}

function stepOnce(ms, recurrence) {
  switch (recurrence) {
    case "daily":
      return ms + DAY_MS;
    case "weekdays": {
      let next = ms + DAY_MS;
      while ([0, 6].includes(new Date(next).getUTCDay())) {
        next += DAY_MS;
      }
      return next;
    }
    case "weekly":
      return ms + 7 * DAY_MS;
    case "monthly":
      return addMonths(ms, 1);
    case "yearly":
      return addMonths(ms, 12);
    default:
      return ms;
  }
}

// The first occurrence after `dueAt` that is still in the future, so an
// overdue task completed today lands on its next future occurrence.
export function nextDueAt(dueAt, recurrence, now = Date.now()) {
  let next = stepOnce(dueAt, normalizeRecurrence(recurrence));
  for (let guard = 0; next <= now && guard < 10000; guard += 1) {
    next = stepOnce(next, normalizeRecurrence(recurrence));
  }
  return next;
}
