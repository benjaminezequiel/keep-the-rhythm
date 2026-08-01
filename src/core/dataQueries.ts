import { getDateStreaks } from "@/utils/utils";
import { DailyActivity, TargetCount, CalculationType } from "@/defs/types";
import { useStore } from "./store";
import {
	formatDate,
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getPlugin } from "@/core/pluginRegistry";
import { moment as _moment, TFile } from "obsidian";
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
	const { today, daysWithCompletedGoal, dailyActivity } =
		useStore.getState();

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
			console.error("Unsupported target type: " + target);
			return 0;
	}

	const value = getTotalValueInDateRange(dailyActivity, startDate, today);
	return calc === CalculationType.AVG ? Math.round(value / totalDays) : value;
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
