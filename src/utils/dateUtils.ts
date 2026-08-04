import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

export function getStartOfMonth(date: Date) {
  return moment(date).startOf("month").toDate();
}

export function getStartOfYear(date: Date) {
  return moment(date).startOf("year").toDate();
}

export function formatDateByMoment(date: moment.MomentInput): string {
  return moment(date).format("YYYY-MM-DD");
}

export function formatDate(date: Date): string {
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a YYYY-MM-DD string into a local-time Date (midnight).
 * Uses native Date constructor — avoids moment overhead.
 */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Compute day difference between two local-time Dates (midnight).
 * Uses noon-based timestamps to avoid DST boundary off-by-one errors.
 */
export function dayDiff(a: Date, b: Date): number {
	const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12);
	const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12);
	return Math.round((d1.getTime() - d2.getTime()) / 86400000);
}


let _todayCache = { date: "", expiresAt: 0 };

export function getToday(): string {
  const now = Date.now();
  if (now >= _todayCache.expiresAt) {
    const m = moment();
    _todayCache = {
      date: m.format("YYYY-MM-DD"),
      expiresAt: m.clone().endOf("day").valueOf() + 1,
    };
  }
  return _todayCache.date;
}

// ─── Monday-of-current-week cache ────────────────────────────────
// The Monday Date only changes when the day crosses a week boundary
// (i.e., at midnight between Sunday and Monday).
let _mondayCache: Date | null = null;
let _mondayCacheToday = "";

/**
 * Return the Monday of the current week (ISO week, Monday-start).
 * Cached per day — invalidated only when `getToday()` returns a new date.
 */
export function getMondayOfCurrentWeek(): Date {
  const todayStr = getToday();
  if (_mondayCacheToday === todayStr && _mondayCache) {
    return _mondayCache;
  }
  const today = new Date();
  const dow = today.getDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offset);
  _mondayCache = monday;
  _mondayCacheToday = todayStr;
  return monday;
}

// ─── Week Dates Cache ─────────────────────────────────────────────
// The 7 dates of the current week (Mon..Sun), cached at module level.
// Only recomputed when today's date changes (midnight boundary).
let _weekDatesCache: string[] | null = null;
let _weekDatesCacheToday = "";

/**
 * Return the 7 YYYY-MM-DD date strings for the current week, Monday → Sunday.
 * Module-level cache invalidated only when `getToday()` returns a new date.
 */
export function getCurrentWeekDates(): string[] {
  const todayStr = getToday();
  if (_weekDatesCacheToday === todayStr && _weekDatesCache) {
    return _weekDatesCache;
  }
  const monday = getMondayOfCurrentWeek();

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatDate(d);
  });
  _weekDatesCache = week;
  _weekDatesCacheToday = todayStr;
  return week;
}

export const getDateForCell = (
	weekIndex: number,
	dayIndex: number,
	totalAmountOfWeeks: number,
	baseDate?: Date,
): Date => {
	if (baseDate) {
		const d = new Date(baseDate);
		d.setDate(d.getDate() + weekIndex * 7 + dayIndex);
		return d;
	}

	const monday = getMondayOfCurrentWeek();
	const weekOffset = weekIndex - (totalAmountOfWeeks - 1);
	const result = new Date(monday);
	result.setDate(result.getDate() + weekOffset * 7 + dayIndex);
	return result;
};

