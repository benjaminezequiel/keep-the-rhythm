import {
	DayActivityMap,
	DaysMap,
	LegacyActivityData,
	PersistedBaselines,
	PersistedDaysMap,
	PersistedFileDict,
} from "@/defs/types";

/*
 * Stats codec — the ONLY module that knows about the split between the
 * persisted shape (dictionary-encoded maps in data.json) and the store's
 * runtime state (full file paths everywhere).
 *
 *   Persisted                                   Runtime (store)
 *   ─────────                                   ─────────────────
 *   stats.fileDict (path → numeric ID)    │
 *   stats.days[date] (id → added)         ├──▶   days: date → filePath → added
 *   stats.todayBaselines.baselines        ──▶   todayBaselines: filePath → initial count
 *   stats.todayBaselines.day              ──▶   todayBaselinesDay: date baselines belong to
 *
 *   Dictionary encoding replaces repeated file-path strings in `days`
 *   and `todayBaselines` with small integer IDs, cutting storage by
 *   ~60–65% for multi-month histories.
 *
 *   Backward compat: the historical structure on master (a `dailyActivity`
 *   array of rows) is accepted transparently on decode and migrated.
 *   Encoding always writes the new dictionary-encoded format.
 *
 *   Legacy v1.x `stats.dailyActivity` (array of rows) is also accepted
 *   on decode and migrated, so upgrading never loses history.
 */

// ─── File dictionary cache ───
//
// We remember the fileDict from the most recent decode so that encode
// can reuse existing IDs instead of reassigning them from scratch every
// time.  This keeps IDs stable across saves, which makes diffs readable
// and avoids needless churn in the persisted file.
//
// IDs are assigned in auto-increment order: new paths get maxId + 1.
// Dead paths (files with zero rows everywhere) are NOT GC'd from the
// dictionary — their IDs stay reserved.  The cost is trivial (a few
// bytes per dead path per save) and the benefit is permanent ID stability.
let cachedFileDict: PersistedFileDict | null = null;
let cachedNextId: number = 0;

/**
 * Remember a fileDict from a decode operation so the next encode can
 * reuse its ID assignments.  Pass null to reset (e.g. on unload).
 */
export function setCachedFileDict(dict: PersistedFileDict | null): void {
	cachedFileDict = dict ? { ...dict } : null;
	cachedNextId = dict
		? Object.keys(dict).reduce((m, p) => Math.max(m, dict[p] + 1), 0)
		: 0;
}

// ─── Encoded historical partition cache ───
//
// The persisted `days` are split into a *historical* partition (all dates
// except today) and today's live row.  Keystrokes only ever change today's
// row, so re-encoding every historical date on each save is wasted work
// that grows with history size.  We cache the encoded historical partition
// keyed by (today, historicalVersion): it is only rebuilt when today rolls
// over, historical data is edited, or an external sync replaces the data.
//
// Today's row is re-encoded fresh on every save (cheap, O(files today)).
let cachedEncToday = "";
let cachedEncHistVer = -1;
let cachedEncHistoricalDays: PersistedDaysMap = {};

/**
 * Reset all module-level codec caches (file dict + encoded historical
 * partition).  Called on plugin unload so stale state can't leak into the
 * next load cycle.
 */
export function resetStatsCodecCache(): void {
	cachedFileDict = null;
	cachedNextId = 0;
	cachedEncToday = "";
	cachedEncHistVer = -1;
	cachedEncHistoricalDays = {};
}

export interface DecodedActivities {
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
	/** All file paths that ever appeared in days (loaded + runtime).
	 *  Used as a fast rejection filter for rename events so we can skip
	 *  the full O(D) scan when a file was never tracked. */
	activeFiles: Set<string>;
}

/** The persisted `stats` section as accepted by decode. */
type StatsInput =
	| {
			days?: DaysMap | PersistedDaysMap;
			fileDict?: PersistedFileDict;
			todayBaselines?: PersistedBaselines;
			dailyActivity?: LegacyActivityData[];
	  }
	| undefined;

/** True when the stats carry a usable (non-empty) file dictionary. */
function hasFileDict(
	stats: StatsInput,
): stats is NonNullable<StatsInput> & { fileDict: PersistedFileDict } {
	return !!stats?.fileDict && Object.keys(stats.fileDict).length > 0;
}

/**
 * Build the id→path lookup array from a fileDict.  Index `i` holds the
 * path whose numeric ID is `i`.
 */
function buildIdToPath(fileDict: PersistedFileDict): string[] {
	const idToPath: string[] = [];
	for (const [path, id] of Object.entries(fileDict)) {
		idToPath[id] = path;
	}
	return idToPath;
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
 * Encode a single day map (path → value) to its dictionary-encoded form
 * (id → value) using the given path→id dictionary.
 */
function encodeDayMap(
	day: DayActivityMap,
	fileDict: PersistedFileDict,
): Record<string, number> {
	const encoded: Record<string, number> = {};
	for (const [path, val] of Object.entries(day)) {
		const id = fileDict[path];
		if (id !== undefined) encoded[String(id)] = val;
	}
	return encoded;
}

/**
 * Decode a single dictionary-encoded day map (id → value) back to
 * (path → value) using the given id→path array.
 */
function decodeDayMap(
	encoded: Record<string, number>,
	idToPath: string[],
): DayActivityMap {
	const day: DayActivityMap = {};
	for (const [idStr, val] of Object.entries(encoded)) {
		const id = Number(idStr);
		const path = idToPath[id];
		if (path !== undefined) day[path] = val;
	}
	return day;
}

/**
 * Prune zero-added rows out of a single day map and encode it, assigning
 * a new auto-incremented ID to any path not yet in the dictionary.
 * Returns the encoded map (empty when the day had no positive rows) plus
 * the running nextId.
 */
function encodeDay(
	day: DayActivityMap,
	fileDict: PersistedFileDict,
	nextId: number,
): { encoded: Record<string, number>; nextId: number } {
	const kept: DayActivityMap = {};
	for (const [filePath, added] of Object.entries(day)) {
		if (added > 0) {
			kept[filePath] = added;
			if (!(filePath in fileDict)) fileDict[filePath] = nextId++;
		}
	}
	if (Object.keys(kept).length === 0) {
		return { encoded: {}, nextId };
	}
	return { encoded: encodeDayMap(kept, fileDict), nextId };
}

/**
 * Keep only baselines for files that actually have added words today, and
 * encode them.  A file that was merely opened but never written needs no
 * persisted anchor (it will re-anchor on its next real touch).  Returns
 * undefined when there is nothing to persist (stale day or no positive
 * rows).
 */
function encodeBaselines(
	todayBaselines: DayActivityMap,
	todayDay: DayActivityMap,
	today: string,
	todayBaselinesDay: string | null,
	fileDict: PersistedFileDict,
): PersistedBaselines | undefined {
	if (todayBaselinesDay !== today) return undefined;
	const kept: DayActivityMap = {};
	for (const [filePath, baseline] of Object.entries(todayBaselines)) {
		if ((todayDay[filePath] ?? 0) > 0) kept[filePath] = baseline;
	}
	if (Object.keys(kept).length === 0) return undefined;
	return { day: today, baselines: encodeDayMap(kept, fileDict) };
}

/**
 * Ensure the cached encoded historical partition (all dates except today)
 * is up to date with the current (today, historicalVersion) key.  The
 * historical partition is stable across keystrokes — it only changes when
 * today rolls over, historical data is edited, or an external sync
 * replaces the data — so on a cache hit this is a no-op and saves re-
 * scanning the whole history on every save.
 *
 * Returns the running nextId (a cache (re)build may have assigned new IDs).
 */
function ensureHistoricalDays(
	inputDays: DaysMap,
	today: string,
	historicalVersion: number,
	fileDict: PersistedFileDict,
	nextId: number,
): number {
	if (today === cachedEncToday && historicalVersion === cachedEncHistVer) {
		return nextId;
	}

	const encoded: PersistedDaysMap = {};
	for (const [date, day] of Object.entries(inputDays)) {
		if (date === today) continue;
		const { encoded: encDay, nextId: nid } = encodeDay(day, fileDict, nextId);
		nextId = nid;
		if (Object.keys(encDay).length > 0) encoded[date] = encDay;
	}

	cachedEncHistoricalDays = encoded;
	cachedEncToday = today;
	cachedEncHistVer = historicalVersion;
	return nextId;
}

/**
 * Decode the persisted `days` into the store's path-keyed shape.  Handles
 * the two real-world input shapes:
 *
 *   1. Dictionary-encoded (fileDict present, id-keyed days) — current
 *   2. Legacy `dailyActivity` array — the historical structure on master
 *
 * The intermediate plain path-keyed `days` shape (no fileDict) was written
 * but never officially released, so it is not handled here.
 */
function decodeDays(stats: StatsInput): DaysMap {
	const rawDays = stats?.days;
	if (hasFileDict(stats) && rawDays && Object.keys(rawDays).length > 0) {
		// Dictionary-encoded: expand id → path.
		const idToPath = buildIdToPath(stats.fileDict);
		const days: DaysMap = {};
		for (const [date, encDay] of Object.entries(rawDays)) {
			days[date] = decodeDayMap(encDay, idToPath);
		}
		return days;
	}
	// Legacy dailyActivity array — migrate to the `days` shape.
	return legacyRowsToDays(stats?.dailyActivity);
}

/**
 * Decode today's baselines.  Baselines follow the same encoding rule as
 * `days` (id-keyed when a fileDict is present);
 * legacy `dailyActivity` rows carry today's starting word count inline.
 */
function decodeBaselines(
	stats: StatsInput,
	today: string,
): { todayBaselines: DayActivityMap; todayBaselinesDay: string | null } {
	const persisted = stats?.todayBaselines;
	// Baselines follow the same encoding rule as `days`: they are id-keyed
	// when a fileDict is present.  The plain path-keyed variant belongs to
	// the never-released intermediate format, so it is not handled here.
	if (
		persisted?.day === today &&
		persisted.baselines &&
		hasFileDict(stats)
	) {
		return {
			todayBaselines: decodeDayMap(
				persisted.baselines,
				buildIdToPath(stats.fileDict),
			),
			todayBaselinesDay: today,
		};
	}

	if (stats?.dailyActivity) {
		const todayBaselines: DayActivityMap = {};
		for (const r of stats.dailyActivity) {
			if (r.date === today) todayBaselines[r.filePath] = r.wordCountStart;
		}
		return {
			todayBaselines,
			todayBaselinesDay:
				Object.keys(todayBaselines).length > 0 ? today : null,
		};
	}

	return { todayBaselines: {}, todayBaselinesDay: null };
}

/**
 * Seed the cached file dictionary (used by encode for ID stability).  A
 * persisted dict is reused as-is; otherwise fresh IDs are assigned in
 * sorted path order for deterministic, cross-device-consistent IDs.
 */
function resolveFileDict(stats: StatsInput, activeFiles: Set<string>): void {
	if (hasFileDict(stats)) {
		setCachedFileDict(stats.fileDict);
		return;
	}
	const freshDict: PersistedFileDict = {};
	let id = 0;
	for (const p of [...activeFiles].sort()) freshDict[p] = id++;
	setCachedFileDict(freshDict);
}

/**
 * Decode the persisted `stats` section into the store's single `days`
 * map plus the current-day baselines.  Legacy rows for today also seed
 * baselines from their `wordCountStart`.
 */
export function decodeActivities(
	stats: StatsInput,
	today: string,
): DecodedActivities {
	const days = decodeDays(stats);
	const { todayBaselines, todayBaselinesDay } = decodeBaselines(stats, today);
	const activeFiles = collectActiveFiles(days);
	resolveFileDict(stats, activeFiles);
	return { days, todayBaselines, todayBaselinesDay, activeFiles };
}

/**
 * Assemble the persisted `stats` section from the store.  Writes the
 * dictionary-encoded format: a `fileDict` (path → numeric ID) plus
 * id-keyed `days` and `todayBaselines`.
 *
 * Empty day maps (no rows at all) are dropped to keep the file small;
 * `todayBaselines` is only written when it is still valid (recorded
 * for the current day) and non-empty.
 *
 * The historical partition is cached across saves (see
 * `ensureHistoricalDays`); only today's live row is re-encoded on each
 * save, so per-keystroke persistence is O(files today).
 */
export function encodePersistedStats({
	today,
	days: inputDays,
	todayBaselines,
	todayBaselinesDay,
	historicalVersion,
}: {
	today: string;
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
	historicalVersion: number;
}): {
	fileDict: PersistedFileDict;
	days: PersistedDaysMap;
	todayBaselines?: PersistedBaselines;
} {
	// The dictionary is the single owner of path→ID assignments.  We reuse
	// the cached dict (from the last decode/encode) for ID stability and
	// mutate it in place to add newly-seen paths.  There is deliberately no
	// copy — the returned `fileDict` is this same object, which is fine
	// because it is only consumed for JSON serialization.
	const fileDict: PersistedFileDict = cachedFileDict ?? (cachedFileDict = {});
	let nextId = cachedNextId;

	// Historical partition: cached, rebuilt only when its version key
	// changes (see ensureHistoricalDays).
	nextId = ensureHistoricalDays(
		inputDays,
		today,
		historicalVersion,
		fileDict,
		nextId,
	);

	// Today's live row: re-encoded fresh on every save.
	const todayDay = inputDays[today] ?? {};
	const { encoded: encodedTodayDay, nextId: todayNextId } = encodeDay(
		todayDay,
		fileDict,
		nextId,
	);
	nextId = todayNextId;
	cachedNextId = nextId;

	const days: PersistedDaysMap = {
		...cachedEncHistoricalDays,
		...(Object.keys(encodedTodayDay).length > 0
			? { [today]: encodedTodayDay }
			: {}),
	};

	const stats: {
		fileDict: PersistedFileDict;
		days: PersistedDaysMap;
		todayBaselines?: PersistedBaselines;
	} = {
		days,
		fileDict,
	};

	const encodedBaselines = encodeBaselines(
		todayBaselines,
		todayDay,
		today,
		todayBaselinesDay,
		fileDict,
	);
	if (encodedBaselines) {
		stats.todayBaselines = encodedBaselines;
	}

	return stats;
}
