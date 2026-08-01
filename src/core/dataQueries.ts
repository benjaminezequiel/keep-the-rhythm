import { getDateStreaks } from "@/utils/utils";
import { DailyActivity, TargetCount, CalculationType } from "@/defs/types";
import { useStore, KTRState } from "./store";
import {
	formatDate,
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getPlugin } from "@/core/pluginRegistry";
import { getDailySummaryMap } from "@/utils/dailySummaryCache";
import { moment as _moment, TFile } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

/** Version selectors for React components to subscribe to. */
export const selectTodayVersion = (s: KTRState) => s.todayVersion;
export const selectHistoricalVersion = (s: KTRState) => s.historicalVersion;

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

/**
 * Compute the inclusive date range [startDate, today] and elapsed days
 * for period-based targets.  Returns null for non-period targets.
 */
function getPeriodRange(
	target: TargetCount,
	today: string,
): { startDate: string; totalDays: number } | null {
	const now = new Date();

	switch (target) {
		case TargetCount.CURRENT_WEEK: {
			const startDate = formatDate(getStartOfWeek(now));
			return {
				startDate,
				totalDays: moment(today).diff(startDate, "days") + 1,
			};
		}
		case TargetCount.CURRENT_MONTH: {
			const startDate = formatDate(getStartOfMonth(now));
			return {
				startDate,
				totalDays: moment(today).diff(startDate, "days") + 1,
			};
		}
		case TargetCount.CURRENT_YEAR: {
			const startDate = formatDate(getStartOfYear(now));
			return {
				startDate,
				totalDays: moment(today).diff(startDate, "days") + 1,
			};
		}
		case TargetCount.LAST_WEEK:
			return {
				startDate: moment(today).subtract(7, "days").format("YYYY-MM-DD"),
				totalDays: 7,
			};
		case TargetCount.LAST_MONTH:
			return {
				startDate: moment(today).subtract(30, "days").format("YYYY-MM-DD"),
				totalDays: 30,
			};
		case TargetCount.LAST_YEAR:
			return {
				startDate: moment(today)
					.subtract(365, "days")
					.format("YYYY-MM-DD"),
				totalDays: 365,
			};
		default:
			return null;
	}
}

/**
 * Resolve the count for the given target.  Reads everything it needs from
 * the store synchronously.  Uses the partitioned cache for O(1) lookups
 * instead of scanning the full dailyActivity array on every call.
 */
export function getCurrentCount(
	target: TargetCount,
	calc?: CalculationType,
): number {
	const {
		today,
		daysWithCompletedGoal,
		dailyActivity,
		todayVersion,
		historicalVersion,
	} = useStore.getState();

	if (target === TargetCount.CURRENT_STREAK) {
		return daysWithCompletedGoal?.length
			? getDateStreaks(daysWithCompletedGoal).currentStreak
			: 0;
	}
	if (target === TargetCount.CURRENT_DAY) {
		const map = getDailySummaryMap(
			dailyActivity,
			today,
			todayVersion,
			historicalVersion,
		);
		return map[today] || 0;
	}
	if (target === TargetCount.LAST_DAY) {
		return getTotalValueFromLast24Hours(dailyActivity);
	}

	const range = getPeriodRange(target, today);
	if (!range) {
		console.error("Unsupported target type: " + target);
		return 0;
	}

	const map = getDailySummaryMap(
		dailyActivity,
		today,
		todayVersion,
		historicalVersion,
	);
	const value = sumRangeFromMap(map, range.startDate, today);
	return calc === CalculationType.AVG
		? Math.round(value / range.totalDays)
		: value;
}

/**
 * Sum word totals from a pre-aggregated date map over an inclusive date
 * range.  O(days) — at most 365 iterations for yearly targets.
 */
function sumRangeFromMap(
	map: Record<string, number>,
	startDate: string,
	endDate: string,
): number {
	let sum = 0;
	const cursor = moment(startDate);
	while (cursor.format("YYYY-MM-DD") <= endDate) {
		const dateStr = cursor.format("YYYY-MM-DD");
		sum += map[dateStr] || 0;
		cursor.add(1, "days");
	}
	return sum;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Write helpers — thin wrappers over store actions so existing call sites
 * (Entries.tsx, ManualEntry.tsx) don't need to know about the store
 * internals.  All persist signaling is handled by the store actions.
 * ────────────────────────────────────────────────────────────────────── */

export async function getExistingOrCreateNewEntry(
	file: TFile,
	date: string,
): Promise<DailyActivity> {
	const { dailyActivity } = useStore.getState();
	let entry = getActivityByDateAndFile(dailyActivity, date, file.path);
	
	if (!entry) {
		entry = await createActivityObject(file, date);
	}
	return entry;
}

async function createActivityObject(file: TFile, date: string) {
	const plugin = getPlugin();
	const content = await plugin.app.vault.read(file);
	const currentWordCount = getLanguageBasedWordCount(
		content,
		useStore.getState().settings.enabledLanguages,
	);

	const newActivity: DailyActivity = {
		date: date,
		filePath: file.path,
		wordCountStart: currentWordCount,
		wordsAdded: 0,
	};

	return newActivity;
}

/**
 * Remove the activity row for (date, filePath).  If the deleted row is the
 * currently open file, also clears `currentActivity`. 
 */
export const deleteActivityFromDate = (
	filePath: string,
	date: string,
): void => {
	useStore.getState().deleteActivity(date, filePath);
};

/**
 * Add or update the activity row for (date, filePath).  If the row exists,
 * update the word count and words added.  If it doesn't exist, create a new row.
 */
export const addOrUpdateActivity = async (
	file: TFile,
	date: string,
	wordAdded: number,
): Promise<void> => {
	const { dailyActivity } = useStore.getState();
	let entry = getActivityByDateAndFile(dailyActivity, date, file.path);
	if (!entry) {
		// 这里的 wordCountStart 并不准确，因为读的最新的文件，不知道历史日期的字数是多少
		entry = await createActivityObject(file, date);
		entry.wordCountStart -= wordAdded;
	}
	entry.wordsAdded = wordAdded;
	useStore.getState().upsertActivity(entry);
};
