import {
	DayActivityMap,
	DaysMap,
	LegacyActivityData,
	PersistedBaselines,
} from "@/defs/types";

/*
 * Stats codec — the ONLY module that knows about the split between the
 * persisted shape (numeric maps in data.json) and the store's runtime
 * state.
 *
 *   Persisted                              Runtime (store)
 *   ─────────                              ─────────────────
 *   stats.days[d] (any date)          ──▶   days: date → filePath → added
 *   stats.todayBaselines.baselines    ──▶   todayBaselines: filePath → initial count
 *   stats.todayBaselines.day          ──▶   todayBaselinesDay: date baselines belong to
 *
 *   `days` includes the current date — the store keeps all dates, today
 *   and past, in a single map.  Legacy v1.x `stats.dailyActivity` (array
 *   of rows) is accepted on decode and migrated, so upgrading never
 *   loses history.
 */

export interface DecodedActivities {
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
	/** All file paths that ever appeared in days (loaded + runtime).
	 *  Used as a fast rejection filter for rename events so we can skip
	 *  the full O(D) scan when a file was never tracked. */
	activeFiles: Set<string>;
}

function legacyRowsToDays(
	rows: LegacyActivityData[] | undefined,
): DaysMap {
	const days: DaysMap = {};
	for (const r of rows ?? []) {
		(days[r.date] ??= {})[r.filePath] = r.wordsAdded;
	}
	return days;
}

/**
 * Collect every filePath that appears in any day map.
 * Used to seed the activeFiles set at load time.
 */
function collectActiveFiles(days: DaysMap): Set<string> {
	const set = new Set<string>();
	for (const day of Object.values(days)) {
		for (const path of Object.keys(day)) set.add(path);
	}
	return set;
}

/**
 * Decode the persisted `stats` section into the store's single `days`
 * map plus the current-day baselines.  Legacy rows for today also seed
 * baselines from their `wordCountStart`.
 */
export function decodeActivities(
	stats:
		| {
				days?: DaysMap;
				todayBaselines?: PersistedBaselines;
				dailyActivity?: LegacyActivityData[];
		  }
		| undefined,
	today: string,
): DecodedActivities {
	const days: DaysMap =
		stats?.days && Object.keys(stats.days).length > 0
			? stats.days
			: legacyRowsToDays(stats?.dailyActivity);

	let todayBaselines: DayActivityMap = {};
	let todayBaselinesDay: string | null = null;

	const persisted = stats?.todayBaselines;
	if (persisted?.day === today && persisted.baselines) {
		todayBaselines = { ...persisted.baselines };
		todayBaselinesDay = today;
	} else if (stats?.dailyActivity) {
		// Legacy: today's rows carry their starting word count inline.
		for (const r of stats.dailyActivity) {
			if (r.date === today) todayBaselines[r.filePath] = r.wordCountStart;
		}
		if (Object.keys(todayBaselines).length > 0) {
			todayBaselinesDay = today;
		}
	}

	return { days, todayBaselines, todayBaselinesDay, activeFiles: collectActiveFiles(days) };
}

/**
 * Assemble the persisted `stats` section from the store.  Empty day maps
 * (no rows at all) are dropped to keep the file small; `todayBaselines`
 * is only written when it is still valid (recorded for the current day)
 * and non-empty.
 */
export function encodePersistedStats({
	today,
	days: inputDays,
	todayBaselines,
	todayBaselinesDay,
}: {
	today: string;
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
}): {
	days: DaysMap;
	todayBaselines?: PersistedBaselines;
} {
	// A `0` row means "file touched but nothing added" — it carries no
	// information (sums look it up as 0 either way) yet would accumulate
	// one entry per file *per day* forever. Drop them on the way out.
	const days: DaysMap = {};
	for (const [date, day] of Object.entries(inputDays)) {
		const kept: DayActivityMap = {};
		for (const [filePath, added] of Object.entries(day)) {
			if (added > 0) kept[filePath] = added;
		}
		if (Object.keys(kept).length > 0) days[date] = kept;
	}

	const stats: { days: DaysMap; todayBaselines?: PersistedBaselines } = {
		days,
	};

	// Baselines only matter for files that actually have added words today;
	// a file that was merely opened but never written needs no persisted
	// anchor (it will re-anchor on its next real touch).
	const todayDay = days[today] ?? {};
	const keptBaselines: DayActivityMap = {};
	for (const [filePath, baseline] of Object.entries(todayBaselines)) {
		if ((todayDay[filePath] ?? 0) > 0) keptBaselines[filePath] = baseline;
	}

	if (
		todayBaselinesDay === today &&
		Object.keys(keptBaselines).length > 0
	) {
		stats.todayBaselines = {
			day: today,
			baselines: keptBaselines,
		};
	}

	return stats;
}