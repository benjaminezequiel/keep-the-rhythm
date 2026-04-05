import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

export function getRelativeDate(daysOffset: number) {
  return moment().add(daysOffset, "days");
}

export function getLastSevenDays() {
  return moment().subtract(7, "days").startOf("day");
}

export function getLastThirthyDays() {
  return moment().subtract(30, "days").startOf("day");
}
export function getLastYearInDays() {
  return moment().subtract(365, "days").startOf("day");
}

// export function getStartOfWeek(date: Date) {
// 	const day = date.getDay();
// 	const diff = date.getDate() - day + (day === 0 ? -6 : 1);
// 	return new Date(date.getFullYear(), date.getMonth(), diff, 0, 0, 0, 0);
// }

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
export function floorMomentToFive(m: any) {
  const ms = 1000 * 60 * 5;
  return moment(Math.floor(m.valueOf() / ms) * ms);
}

export const formatDate = (date: Date): string => {
  return moment(date).format("YYYY-MM-DD");
};

export function getDateBasedOnIndex(index: number) {
  const today = moment();
  const monday = today.clone().startOf("isoWeek"); // isoWeek starts on Monday
  return monday.clone().add(index, "days").format("YYYY-MM-DD");
}

export function scheduleNextDayTrigger(onDayChange: () => void): number {
  const now = window.moment();
  const nextDay = now.clone().add(1, "day").startOf("day");

  const msUntilNextDay = nextDay.diff(now);

  return window.setTimeout(() => {
    onDayChange();
    // Schedule the next day automatically
    scheduleNextDayTrigger(onDayChange);
  }, msUntilNextDay);
}

export function getCurrentTimeKey() {
  return floorMomentToFive(moment()).format("HH:mm");
}
