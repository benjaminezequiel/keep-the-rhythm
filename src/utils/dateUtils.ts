import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

export function getStartOfWeek(date: Date, weekStart: number = 1): Date {
  const m = moment(date);
  return m.isoWeekday(weekStart).startOf("day").toDate();
}

export function getStartOfMonth(date: Date) {
  return moment(date).startOf("month").toDate();
}

export function getStartOfYear(date: Date) {
  return moment(date).startOf("year").toDate();
}
export function getLastDay() {
  return moment().subtract(1, "day");
}

export const formatDateByMoment = (date: moment.MomentInput): string => {
  return moment(date).format("YYYY-MM-DD");
}

export const formatDate = (date: Date): string => {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

export function getDateBasedOnIndex(index: number) {
  const today = moment();
  const monday = today.clone().startOf("isoWeek"); // isoWeek starts on Monday
  return monday.clone().add(index, "days").format("YYYY-MM-DD");
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

	const today = new Date();
	const monday = new Date(today);
	monday.setDate(monday.getDate() - getDayIndex(monday.getDay()));

	const weekOffset = weekIndex - (totalAmountOfWeeks - 1);
	monday.setDate(monday.getDate() + weekOffset * 7 + dayIndex);
	return monday;
};

const getDayIndex = (dayIndex: number): number => {
	return dayIndex === 0 ? 6 : dayIndex - 1;
};
