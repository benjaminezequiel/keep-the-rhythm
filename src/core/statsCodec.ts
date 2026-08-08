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

	return { days, todayBaselines, todayBaselinesDay };
}

/**
 * Assemble the persisted `stats` section from the store.  Empty day maps
 * (no rows at all) are dropped to keep the file small; `todayBaselines`
 * is only written when it is still valid (recorded for the current day)
 * and non-empty.
 */
export function encodePersistedStats(parts: {
	today: string;
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
}): {
	days: DaysMap;
	todayBaselines?: PersistedBaselines;
} {
	const days: DaysMap = {};
	for (const [date, day] of Object.entries(parts.days)) {
		if (Object.keys(day).length > 0) days[date] = day;
	}

	const stats: { days: DaysMap; todayBaselines?: PersistedBaselines } = {
		days,
	};

	if (
		parts.todayBaselinesDay === parts.today &&
		Object.keys(parts.todayBaselines).length > 0
	) {
		stats.todayBaselines = {
			day: parts.today,
			baselines: parts.todayBaselines,
		};
	}

	return stats;
}