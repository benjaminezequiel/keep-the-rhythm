import { DailyActivity } from "@/defs/types";

// ─── Partitioned Cache ────────────────────────────────────────────
// Two independent partitions so that typing (today data changes)
// doesn't invalidate the historical aggregate map.
// ──────────────────────────────────────────────────────────────────

// Historical partition: entries with date < today
let cachedHistoricalMap: Record<string, number> | null = null;
let cachedHistoricalVersion = -1;
let cachedHistoricalToday: string | null = null;

// Today partition: entries with date === today
let cachedTodayEntries: DailyActivity[] | null = null;
let cachedTodayVersion = -1;
let cachedTodayDate: string | null = null;

// Merged result cache: set after a merge, reused when neither
// partition has changed since the last call.
let cachedMergedMap: Record<string, number> | null = null;

/**
 * Get a date → total-words summary map built from partitioned caches.
 *
 * The historical partition (date < today) is rebuilt only when
 * `historicalVersion` changes or the `today` boundary shifts —
 * which rarely happens relative to the typing rate.
 *
 * The today partition (date === today) is rebuilt on every keystroke
 * but contains only a handful of entries (k < 10).
 *
 * Merging the two partitions is O(k).
 */
export function getDailySummaryMap(
	dailyActivity: DailyActivity[],
	today: string,
	todayVersion: number,
	historicalVersion: number,
): Record<string, number> {
	let changed = false;
	// ── Rebuild historical partition if needed ──
	if (
		historicalVersion !== cachedHistoricalVersion ||
		cachedHistoricalToday !== today
	) {
		changed = true;
		const historical = dailyActivity.filter((a) => a.date < today);
		cachedHistoricalMap = aggregateByDate(historical);
		cachedHistoricalVersion = historicalVersion;
		cachedHistoricalToday = today;
	}

	// ── Rebuild today partition if needed ──
	if (todayVersion !== cachedTodayVersion || cachedTodayDate !== today) {
		changed = true;
		cachedTodayEntries = dailyActivity.filter((a) => a.date === today);
		cachedTodayVersion = todayVersion;
		cachedTodayDate = today;
	}
	
	// ── Merge (cached): O(N) clone + O(k) merge, skipped when
	// neither partition has changed since the last call. ──
	if (!changed && cachedMergedMap !== null) {
		return cachedMergedMap;
	}

	const result = { ...cachedHistoricalMap };
	for (const entry of cachedTodayEntries!) {
		result[entry.date] = (result[entry.date] || 0) + entry.wordsAdded;
	}
	cachedMergedMap = result;
	return result;
}

/**
 * Get today's entries list (not aggregated). Used by Entries component.
 * Returns a cached copy that only rebuilds when todayVersion changes
 * or the date boundary shifts.
 */
export function getTodayEntries(
	dailyActivity: DailyActivity[],
	today: string,
	todayVersion: number,
): DailyActivity[] {
	if (todayVersion !== cachedTodayVersion || cachedTodayDate !== today) {
		cachedTodayEntries = dailyActivity.filter((a) => a.date === today);
		cachedTodayVersion = todayVersion;
		cachedTodayDate = today;
	}
	return cachedTodayEntries!;
}

function aggregateByDate(entries: DailyActivity[]): Record<string, number> {
	const map: Record<string, number> = {};
	for (const entry of entries) {
		map[entry.date] = (map[entry.date] || 0) + entry.wordsAdded;
	}
	return map;
}

// ─── Streak Cache ────────────────────────────────────────────────
// Separate cache for CURRENT_STREAK since it depends on the goal
// threshold (a settings value) in addition to data versions.
// ──────────────────────────────────────────────────────────────────

let cachedStreak = 0;
let cachedStreakKey = "";

/**
 * Compute the current writing streak (consecutive days meeting the goal
 * ending today).  Results are cached keyed by data versions + goal so
 * that repeated calls during the same render are O(1).
 *
 * Uses the existing getDailySummaryMap partition cache — when neither
 * partition has changed, the map is reused and only the streak's own
 * cache key needs to match.
 */
export function getStreak(
	dailyActivity: DailyActivity[],
	today: string,
	todayVersion: number,
	historicalVersion: number,
	goal: number,
): number {
	const key = `${today}|${todayVersion}|${historicalVersion}|${goal}`;
	if (cachedStreakKey === key) return cachedStreak;

	const map = getDailySummaryMap(
		dailyActivity,
		today,
		todayVersion,
		historicalVersion,
	);

	const qualifying = new Set<string>();
	for (const [date, words] of Object.entries(map)) {
		if (words >= goal) qualifying.add(date);
	}

	let streak = 0;
	let cursor = today;
	while (qualifying.has(cursor)) {
		streak++;
		cursor = previousDay(cursor);
	}

	cachedStreak = streak;
	cachedStreakKey = key;
	return streak;
}

function previousDay(date: string): string {
	const d = new Date(date + "T00:00:00");
	d.setDate(d.getDate() - 1);
	return d.toISOString().slice(0, 10);
}

/**
 * Reset all cached data. Called on plugin unload and during tests.
 */
export function resetDailySummaryCache(): void {
	cachedHistoricalMap = null;
	cachedHistoricalVersion = -1;
	cachedHistoricalToday = null;
	cachedTodayEntries = null;
	cachedTodayVersion = -1;
	cachedTodayDate = null;
	cachedMergedMap = null;
	cachedStreak = 0;
	cachedStreakKey = "";
}