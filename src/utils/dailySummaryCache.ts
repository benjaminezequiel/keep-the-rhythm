import { DailyActivity } from "@/defs/types";
import { useStore } from "@/core/store";

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
export function getDailySummaryMap(): Record<string, number> {
	const { dailyActivity, today, todayVersion, historicalVersion } =
		useStore.getState();

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
export function getTodayEntries(): DailyActivity[] {
	const { dailyActivity, today, todayVersion } = useStore.getState();
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

	// Historical streak (from yesterday backwards) — cached separately
	// by (today, historicalVersion, goal) so it persists across keystrokes.
	const histKey = `${today}|${historicalVersion}|${goal}`;
	if (cachedHistoricalStreakKey !== histKey) {
		// Piggyback on getDailySummaryMap's historical partition cache.
		// The merge is O(N) but this block is only entered when
		// historicalVersion, today, or goal changes — not on every keystroke.
		const map = getDailySummaryMap();
		cachedHistoricalStreak = 0;
		let cursor = previousDay(today);
		while (true) {
			const words = map[cursor];
			if (words === undefined || words < goal) break;
			cachedHistoricalStreak++;
			cursor = previousDay(cursor);
		}
		cachedHistoricalStreakKey = histKey;
	}

	// Check today's total via getTodayEntries (cached, O(k) k < 10)
	const todayEntries = getTodayEntries();
	if (todayEntries.reduce((sum, a) => sum + a.wordsAdded, 0) < goal) {
		// Today not yet completed — return historical streak only
		cachedStreak = cachedHistoricalStreak;
		cachedStreakKey = key;
		return cachedStreak;
	}

	cachedStreak = 1 + cachedHistoricalStreak;
	cachedStreakKey = key;
	return cachedStreak;
}

function previousDay(date: string): string {
	const [y, m, d] = date.split("-").map(Number);
	const dt = new Date(y, m - 1, d);
	dt.setDate(dt.getDate() - 1);
	const yy = dt.getFullYear();
	const mm = String(dt.getMonth() + 1).padStart(2, "0");
	const dd = String(dt.getDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
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
	cachedHistoricalStreak = 0;
	cachedHistoricalStreakKey = "";
}