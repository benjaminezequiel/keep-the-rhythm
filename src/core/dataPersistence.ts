import { DEFAULT_SETTINGS, STARTING_STATS, PluginData } from "@/defs/types";
import { getDB } from "@/db/db";
import KeepTheRhythm from "../main";
import { checkPreviousStreak } from "./commands";
import { useStore } from "./store";

const JSON_DEBOUNCE_TIME = 1000;

/**
 * Initialize plugin data from loaded data.json content.
 * Populates plugin.data and syncs dailyActivity into IndexedDB.
 */
export async function initializeDataFromJSON(
	plugin: { data: PluginData },
	loadedData: PluginData,
) {
	if (!loadedData) {
		plugin.data.stats = {
			...STARTING_STATS,
		};
		return;
	}
	if (loadedData.settings) {
		plugin.data.settings = {
			...DEFAULT_SETTINGS,
			...loadedData.settings,
		};
	}
	if (loadedData.stats) {
		plugin.data.stats = loadedData.stats;
		await checkPreviousStreak();

		const dailyActivitiesFromJSON =
			plugin.data.stats?.dailyActivity || [];

		try {
			/** BulkPut updates the records if they already exist! */
			await getDB().dailyActivity.bulkPut(dailyActivitiesFromJSON);
		} catch (error) {
			console.error(
				"Failed loading some data, contact the developer.",
				error,
			);
		}
	}
}

/**
 * Persist IndexedDB dailyActivity to plugin.data and save to data.json.
 * Guards against overwriting data.json with empty data when IndexedDB is
 * empty but in-memory stats still have entries.
 */
async function saveDataToJSON(
	plugin: KeepTheRhythm,
) {
	const dailyActivityDB = await getDB().dailyActivity.toArray();

	// Safety guard: if the DB is empty but we have entries in memory, the DB
	// was likely cleared by a race (e.g., a stale timer callback or an
	// un-awaited clear()).  Don't overwrite data.json with empty data.
	if (
		dailyActivityDB.length === 0 &&
		(plugin.data.stats?.dailyActivity?.length ?? 0) > 0
	) {
		return;
	}

	plugin.data.stats = {
		...plugin.data.stats,
		dailyActivity: dailyActivityDB,
	};

	await plugin.saveData(plugin.data);
}

/**
 * Immediately flush IndexedDB data to data.json.
 * Used during plugin unload to ensure data is persisted before teardown.
 */
export async function flushToJSON(plugin: KeepTheRhythm) {
	await saveDataToJSON(plugin);
}

/**
 * Holds the debounce and generation state for persistence scheduling.
 */
export interface PersistenceScheduler {
	dispose: () => void;
}

/**
 * Setup debounced JSON persistence scheduling.
 * Subscribes to persistVersion changes from store and schedules debounced saves.
 * Returns scheduler with dispose to be called on unload.
 */
export function setupPersistenceScheduling(
	plugin: KeepTheRhythm,
): PersistenceScheduler {
	let JsonDebounceTimeout: any = null;
	let _saveGen = 0;

	const scheduleSave = () => {
		clearTimeout(JsonDebounceTimeout);
		
		_saveGen++;
		const gen = _saveGen;
		JsonDebounceTimeout = setTimeout(async () => {
			if (gen !== _saveGen) return;
			JsonDebounceTimeout = null;
			await saveDataToJSON(plugin);
		}, JSON_DEBOUNCE_TIME);
	};

	const unsub = useStore.subscribe(
		(s) => s.persistVersion,
		() => scheduleSave(),
	);

	return {
		dispose: () => {
			unsub();
			_saveGen++;
			clearTimeout(JsonDebounceTimeout);
			JsonDebounceTimeout = null;
		},
	};
}