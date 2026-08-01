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
	// ── Merge: O(k), k = today entries (typically < 10) ──
	// Always merge — the historical partition never includes today's
	// entries, so skipping the merge would cause CURRENT_DAY and
	// CURRENT_MONTH reads to see a map missing today's data.
	const result = { ...cachedHistoricalMap };
	for (const entry of cachedTodayEntries!) {
		result[entry.date] = (result[entry.date] || 0) + entry.wordsAdded;
	}
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
}