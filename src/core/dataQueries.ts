import { getDateStreaks, sumTimeEntries } from "@/utils/utils";
import { DailyActivity, TargetCount, CalculationType } from "@/defs/types";
import { useStore } from "./store";
import { getPlugin } from "./pluginRegistry";
import {
	formatDate,
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

/* ─────────────────────────────────────────────────────────────────────────
 * Pure read helpers (array → value).
 *
 * Take the dailyActivity array explicitly so the same code is usable from
 * React (via `useStore(s => s.dailyActivity)` + useMemo) and from
 * non-React callers (via `useStore.getState().dailyActivity`).
 * ────────────────────────────────────────────────────────────────────── */

export function getActivityByDate(
	dailyActivity: DailyActivity[],
	date: string,
): DailyActivity[] {
	return dailyActivity.filter((a) => a.date === date);
}

export function getActivityByDateAndFile(
	dailyActivity: DailyActivity[],
	date: string,
	filePath: string,
): DailyActivity | undefined {
	return dailyActivity.find(
		(a) => a.date === date && a.filePath === filePath,
	);
}

export function getTotalValueByDate(
	dailyActivity: DailyActivity[],
	date: string,
): number {
	return getActivityByDate(dailyActivity, date).reduce(
		(sum, a) => sum + (a.wordsAdded || 0),
		0,
	);
}

export function getTotalValueInDateRange(
	dailyActivity: DailyActivity[],
	startDate: string,
	endDate: string,
): number {
	return dailyActivity
		.filter((a) => a.date >= startDate && a.date <= endDate)
		.reduce((sum, a) => sum + (a.wordsAdded || 0), 0);
}

export function getActivitiesFromLast24Hours(
	dailyActivity: DailyActivity[],
	now: Date = new Date(),
): DailyActivity[] {
	const cutoff = moment(now).subtract(24, "hours").format("YYYY-MM-DD");
	return dailyActivity.filter((a) => a.date >= cutoff);
}

export function getTotalValueFromLast24Hours(
	dailyActivity: DailyActivity[],
	now: Date = new Date(),
): number {
	return getActivitiesFromLast24Hours(dailyActivity, now).reduce(
		(sum, a) => sum + (a.wordsAdded || 0),
		0,
	);
}

export function sumLast24Hours(
	activities: DailyActivity[],
	now: Date = new Date(),
): number {
	const cutoff = moment(now).subtract(24, "hours").format("YYYY-MM-DD");

	let total = 0;

	for (const activity of activities) {
		if (activity.date >= cutoff) {
			total += activity.wordsAdded || 0;
		}
	}

	return total;
}

/**
 * Resolve the count for the given target.  Reads everything it needs from
 * the store synchronously.  Replaces the old async getCurrentCount which
 * existed only to await Dexie queries.
 */
export function getCurrentCount(
	target: TargetCount,
	calc?: CalculationType,
): number {
	const { today, currentActivity, daysWithCompletedGoal, dailyActivity } =
		useStore.getState();

	if (target === TargetCount.CURRENT_FILE) {
		if (currentActivity) {
			return sumTimeEntries(currentActivity) || 0;
		}
		const activeFile = getPlugin().app.workspace.getActiveFile();
		if (activeFile) {
			return dailyActivity
				.filter((a) => a.filePath === activeFile.path)
				.reduce((sum, a) => sum + sumTimeEntries(a), 0);
		}
		return 0;
	}

	if (target === TargetCount.CURRENT_STREAK) {
		if (daysWithCompletedGoal?.length) {
			return getDateStreaks(daysWithCompletedGoal).currentStreak;
		}
		return 0;
	}

	if (target === TargetCount.CURRENT_DAY) {
		return getTotalValueByDate(dailyActivity, today);
	}

	if (target === TargetCount.LAST_DAY) {
		return getTotalValueFromLast24Hours(dailyActivity);
	}

	let startDate: string;
	let totalDays: number;

	switch (target) {
		case TargetCount.CURRENT_WEEK:
			startDate = formatDate(getStartOfWeek(new Date()));
			totalDays = moment(today).diff(startDate, "days") + 1;
			break;
		case TargetCount.CURRENT_MONTH:
			startDate = formatDate(getStartOfMonth(new Date()));
			totalDays = moment(today).diff(startDate, "days") + 1;
			break;
		case TargetCount.CURRENT_YEAR:
			startDate = formatDate(getStartOfYear(new Date()));
			totalDays =
				Math.floor(
					(new Date(today).getTime() -
						new Date(startDate).getTime()) /
						(1000 * 3600 * 24),
				) + 1;
			break;
		case TargetCount.LAST_WEEK:
			startDate = moment(today).subtract(7, "days").format("YYYY-MM-DD");
			totalDays = 7;
			break;
		case TargetCount.LAST_MONTH:
			startDate = moment(today).subtract(30, "days").format("YYYY-MM-DD");
			totalDays = 30;
			break;
		case TargetCount.LAST_YEAR:
			startDate = moment(today)
				.subtract(365, "days")
				.format("YYYY-MM-DD");
			totalDays = 365;
			break;
		default:
			throw new Error("Unsupported target type");
	}

	const value = getTotalValueInDateRange(dailyActivity, startDate, today);
	return calc === CalculationType.AVG ? Math.round(value / totalDays) : value;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Write helpers — thin wrappers over store actions so existing call sites
 * (Entries.tsx, ManualEntry.tsx) don't need to know about the store
 * internals.  All persist signaling is handled by the store actions.
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Remove the activity row for (date, filePath).  If the deleted row is the
 * currently open file, also clears `currentActivity`.  Replacement for the
 * old async deleteActivityFromDate that called `getDB().delete()`.
 */
export const deleteActivityFromDate = (
	filePath: string,
	date: string,
): void => {
	const store = useStore.getState();
	if (filePath == store.currentActivity?.filePath) {
		store.setCurrentActivity(null);
	}
	store.deleteActivity(date, filePath);
	// deleteActivity already calls requestPersist.
};

/**
 * Apply `wordsDelta` to the given activity's row.  Replaces the old async
 * addDeltaToActivity that called `getDB().modify()`.  Persist signaling is
 * handled by modifyActivity.
 */
export const addDeltaToActivity = (
	dailyActivity: DailyActivity,
	wordsDelta: number,
): void => {
	useStore
		.getState()
		.modifyActivity(dailyActivity.date, dailyActivity.filePath, (row) => {
			row.wordsAdded = (row.wordsAdded || 0) + wordsDelta;
		});
};
