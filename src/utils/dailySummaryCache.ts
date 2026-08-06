import { useStore } from "@/core/store";
import { parseDate, formatDate } from "./dateUtils";

// ─── Date → Total-Words Map Cache ───────────────────────────────
// A single persistent merged map. A full O(N) rebuild happens only when
// the historical partition changes (rare); the typing hot path (today-only
// change) swaps the `today` key in the existing object in place, so it
// never copies the whole historical map.
//
// Invalidation is tracked by the two partition version stamps from the
// store plus the `today` boundary. All callers consume the map
// synchronously inside a recompute keyed on those versions, never
// retaining the reference across changes, so in-place mutation is safe.
// ──────────────────────────────────────────────────────────────────

let cachedMergedMap: Record<string, number> = {};
let cachedHistoricalVersion = -1;
let cachedTodayVersion = -1;
let cachedToday = "";

/**
 * Get a date → total-words summary map built from the store's two
 * partitions (historical date < today, today date === today).
 */
export function getDailySummaryMap(): Record<string, number> {
	const { historicalActivity, today, todayVersion, historicalVersion } =
		useStore.getState();

	// Fast path: nothing changed since the last call.
	// Version stamps alone determine cache validity — even an empty cached
	// object (no entries) is valid if versions match (no historical data yet).
	if (
		historicalVersion === cachedHistoricalVersion &&
		todayVersion === cachedTodayVersion &&
		today === cachedToday
	) {
		return cachedMergedMap;
	}

	// A `today` boundary shift always bumps historicalVersion too (see
	// store.checkDayChange), so the version stamp covers day rollover; the
	// `today !== cachedToday` check is a defensive guard.
	const historicalChanged =
		historicalVersion !== cachedHistoricalVersion ||
		today !== cachedToday;

	if (historicalChanged) {
		// Full rebuild — rare (historical edits, day rollover, external
		// sync). The O(N) merge happens here, never on the hot path.
		const map: Record<string, number> = {};
		for (const entry of historicalActivity) {
			map[entry.date] = (map[entry.date] || 0) + entry.wordsAdded;
		}
		cachedMergedMap = map;
	}

	// Today overlay — hot path (typing): swap the today keys in the
	// persistent merged map instead of copying the whole historical map.
	// Every today entry shares date === today, so the stale contribution is
	// a single key. O(k) — typically one key.
	cachedMergedMap[today] = countTodayWordsAdded();

	cachedHistoricalVersion = historicalVersion;
	cachedTodayVersion = todayVersion;
	cachedToday = today;
	return cachedMergedMap;
}

function countTodayWordsAdded(): number {
	return useStore.getState().todayActivity.reduce((acc, cur) => acc + cur.wordsAdded, 0);
}

// ─── Streak Cache ────────────────────────────────────────────────
// Two-tier cache:
// 1. Outer cache (cachedStreakKey) — keyed by everything, invalidated
//    on every keystroke via todayVersion.
// 2. Historical streak cache (cachedHistoricalStreakKey) — keyed by
//    (today, historicalVersion, goal), NOT todayVersion, so it persists
//    across keystrokes and avoids the O(N) full-map scan on every edit.
// ──────────────────────────────────────────────────────────────────

let cachedStreak = 0;
let cachedStreakKey = "";
let cachedHistoricalStreak = 0;
let cachedHistoricalStreakKey = "";

/**
 * Compute the current writing streak (consecutive days meeting the goal
 * ending today).
 *
 * Uses a two-tier cache strategy:
 * - Today's check uses getTodayEntries (O(k), k < 10)
 * - The historical streak (yesterday backwards) is cached separately by
 *   (today, historicalVersion, goal) — NOT todayVersion — so it survives
 *   every keystroke and avoids the O(N) full-map iteration.
 */
export function getStreak(): number {
	const { today, todayVersion, historicalVersion, settings } =
		useStore.getState();
	const goal = settings.dailyWritingGoal;

	const key = `${today}|${todayVersion}|${historicalVersion}|${goal}`;
	if (cachedStreakKey === key) return cachedStreak;

	// Reads getDailySummaryMap, whose historical partition is only
	// rebuilt when historicalVersion, today, or goal changes — not on
	// every keystroke.
	const dailySummaryMap = getDailySummaryMap();

	// Historical streak (from yesterday backwards) — cached separately
	// by (today, historicalVersion, goal) so it persists across keystrokes.
	const histKey = `${today}|${historicalVersion}|${goal}`;
	if (cachedHistoricalStreakKey !== histKey) {
		cachedHistoricalStreak = 0;
		const cursor = 	parseDate(today);
		cursor.setDate(cursor.getDate() - 1);
		while (true) {
			const words = dailySummaryMap[formatDate(cursor)];
			if (words === undefined || words < goal) break;
			cachedHistoricalStreak++;
			cursor.setDate(cursor.getDate() - 1);
		}
		cachedHistoricalStreakKey = histKey;
	}

	const isTodayStreak = dailySummaryMap[today] >= goal;
	
	cachedStreak = cachedHistoricalStreak + (isTodayStreak ? 1 : 0);
	cachedStreakKey = key;
	return cachedStreak;
}

/**
 * Reset all cached data. Called on plugin unload and during tests.
 */
export function resetDailySummaryCache(): void {
	cachedMergedMap = {};
	cachedHistoricalVersion = -1;
	cachedTodayVersion = -1;
	cachedToday = "";
	cachedStreak = 0;
	cachedStreakKey = "";
	cachedHistoricalStreak = 0;
	cachedHistoricalStreakKey = "";
}
