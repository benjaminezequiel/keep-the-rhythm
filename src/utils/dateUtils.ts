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

export const formatDate = (date: Date): string => {
  return moment(date).format("YYYY-MM-DD");
};

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
