import { DailyActivity, TargetCount, CalculationType } from "@/defs/types";
import { useStore, KTRState } from "./store";
import {
	dayDiff,
	formatDate,
	getStartOfMonth,
	getMondayOfCurrentWeek,
	getStartOfYear,
	parseDate,
} from "@/utils/dateUtils";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { getPlugin } from "@/core/pluginRegistry";
import { getDailySummaryMap, getStreak } from "@/utils/dailySummaryCache";
import { TFile } from "obsidian";

/** Version selectors for React components to subscribe to. */
export const selectTodayVersion = (s: KTRState) => s.todayVersion;
export const selectHistoricalVersion = (s: KTRState) => s.historicalVersion;

/**
 * React selector returning the merged, flattened activity set
 * (historical then today).  Returns a fresh array on every evaluation, so
 * this is intended for cold paths (e.g. the filtered heatmap) that already
 * re-run on historicalVersion/todayVersion; do NOT use it in a component
 * that must stay stable across unrelated re-renders.
 */
export const selectAllActivity = (s: KTRState) => [
	...s.historicalActivity,
	...s.todayActivity,
];

/* ─────────────────────────────────────────────────────────────────────────
 * Pure read helpers (array → value).
 *
 * ────────────────────────────────────────────────────────────────────── */

/** Merge helper for non-React reads. */
function getAllActivity(): DailyActivity[] {
	const { historicalActivity, todayActivity } = useStore.getState();
	return [...historicalActivity, ...todayActivity];
}

export function getActivityByDate(
	date: string,
): DailyActivity[] {
	const { today, todayActivity } = useStore.getState();
	if (date === today) return todayActivity;
	return useStore.getState().historicalActivity.filter((a) => a.date === date);
}

export function getActivityByDateAndFile(
	date: string,
	filePath: string,
): DailyActivity | undefined {
	const { today, todayActivity } = useStore.getState();
	if (date === today) {
		return todayActivity.find(
			(a) => a.date === date && a.filePath === filePath,
		);
	}
	return useStore.getState().historicalActivity.find(
		(a) => a.date === date && a.filePath === filePath,
	);
}

type PeriodRange = { startDate: string; totalDays: number };

let _rangeCache: {
	today: string;
	ranges: Partial<Record<TargetCount, PeriodRange>>;
} = { today: "", ranges: {} };

/**
 * Compute the inclusive date range [startDate, today] and elapsed days
 * for period-based targets. Returns null for non-period targets.
 *
 * Pure date arithmetic — no data reads. Results are cached per day: once a
 * target's dates are computed for a given today string, subsequent calls
 * are O(1) map lookups. Invalidated when today changes.
 */
function getPeriodRange(
	target: TargetCount,
): PeriodRange | null {
	const today = useStore.getState().today;

	if (_rangeCache.today !== today) {
		_rangeCache.today = today;
		_rangeCache.ranges = {};
	}

	const cached = _rangeCache.ranges[target];
	if (cached !== undefined) return cached;

	const todayDate = parseDate(today);
	let result: PeriodRange;

	switch (target) {
		case TargetCount.CURRENT_WEEK: {
			const start = getMondayOfCurrentWeek();
			result = {
				startDate: formatDate(start),
				totalDays: dayDiff(todayDate, start) + 1,
			};
			break;
		}
		case TargetCount.CURRENT_MONTH: {
			const start = getStartOfMonth(todayDate);
			result = {
				startDate: formatDate(start),
				totalDays: dayDiff(todayDate, start) + 1,
			};
			break;
		}
		case TargetCount.CURRENT_YEAR: {
			const start = getStartOfYear(todayDate);
			result = {
				startDate: formatDate(start),
				totalDays: dayDiff(todayDate, start) + 1,
			};
			break;
		}
		case TargetCount.LAST_WEEK: {
			const start = new Date(todayDate);
			start.setDate(start.getDate() - 7);
			result = { startDate: formatDate(start), totalDays: 7 };
			break;
		}
		case TargetCount.LAST_MONTH: {
			const start = new Date(todayDate);
			start.setDate(start.getDate() - 30);
			result = { startDate: formatDate(start), totalDays: 30 };
			break;
		}
		case TargetCount.LAST_YEAR: {
			const start = new Date(todayDate);
			start.setDate(start.getDate() - 365);
			result = { startDate: formatDate(start), totalDays: 365 };
			break;
		}
		default:
			return null;
	}

	_rangeCache.ranges[target] = result;
	return result;
}

let _sumCache: {
	today: string;
	historicalVersion: number;
	sums: Partial<Record<TargetCount, number>>;
} = { today: "", historicalVersion: -1, sums: {} };

/**
 * Sum words over a period target's full range [startDate, today].
 * Cached by (target, today, historicalVersion): the historical partition
 * doesn't change on keystrokes, so the O(days) walk (7 / 30 / 365) runs
 * only when today or historicalVersion changes; per keystroke the cached
 * total already includes the stable historical part, re-summed cheaply
 * with today's live overlay below.
 */
function getPeriodHistoricalSum(target: TargetCount): number {
	const { today, historicalVersion } = useStore.getState();

	if (
		_sumCache.today !== today ||
		_sumCache.historicalVersion !== historicalVersion
	) {
		_sumCache.today = today;
		_sumCache.historicalVersion = historicalVersion;
		_sumCache.sums = {};
	}

	const cached = _sumCache.sums[target];
	if (cached !== undefined) return cached;

	const range = getPeriodRange(target);
	if (!range) return 0;

	// Walk [startDate, today) across the historical partition once — today's
	// live row is untouched so keystrokes never re-enter this loop.
	const map = getDailySummaryMap();
	let sum = 0;
	const start = parseDate(range.startDate);
	const cursor = new Date(parseDate(today));
	cursor.setDate(cursor.getDate() - 1);
	while (cursor >= start) {
		sum += map[formatDate(cursor)] || 0;
		cursor.setDate(cursor.getDate() - 1);
	}

	_sumCache.sums[target] = sum;
	return sum;
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
	const { today } = useStore.getState();
	if (target === TargetCount.CURRENT_STREAK) {
		return getStreak();
	}
	if (target === TargetCount.CURRENT_DAY) {
		const map = getDailySummaryMap();
		return map[today] || 0;
	}
	if (target === TargetCount.LAST_DAY) {
		const map = getDailySummaryMap();
		const yesterdayDate = parseDate(today);
		yesterdayDate.setDate(yesterdayDate.getDate() - 1);
		const yesterday = formatDate(yesterdayDate);
		return (map[yesterday] || 0) + (map[today] || 0);
	}

	const range = getPeriodRange(target);
	if (!range) {
		console.error("Unsupported target type: " + target);
		return 0;
	}

	// getPeriodSum is cached across keystrokes (historical part is stable);
	// only today's live row is overlaid here, so typing stays O(1).
	const map = getDailySummaryMap();
	const value = getPeriodHistoricalSum(target) + (map[today] || 0);
	return calc === CalculationType.AVG
		? Math.round(value / range.totalDays)
		: value;
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
	let entry = getActivityByDateAndFile(date, file.path);
	
	if (!entry) {
		entry = await createActivityObject(file, date);
		useStore.getState().upsertActivity(entry);
	}
	return entry;
}

async function createActivityObject(file: TFile, date: string) {
	const plugin = getPlugin();
	let content = await plugin.app.vault.cachedRead(file);
	if (content === null) {
		content = await plugin.app.vault.read(file);
	}
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
 * Remove the activity row for (date, filePath).
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
	let entry = getActivityByDateAndFile(date, file.path);
	if (!entry) {
		// 这里的 wordCountStart 并不准确，因为读的最新的文件，不知道历史日期的字数是多少
		entry = await createActivityObject(file, date);
		entry.wordCountStart -= wordAdded;
	}
	entry.wordsAdded = wordAdded;
	useStore.getState().upsertActivity(entry);
};
