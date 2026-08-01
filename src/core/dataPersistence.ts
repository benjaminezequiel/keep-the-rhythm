import { DEFAULT_SETTINGS, STARTING_STATS, PluginData } from "@/defs/types";
import { useStore } from "./store";
import KeepTheRhythm from "../main";

const JSON_DEBOUNCE_TIME = 1000;

/**
 * Initialize plugin data from loaded data.json content.
 * Populates plugin.data and the in-memory store (dailyActivity slice).
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
	}
}

/**
 * Persist in-memory dailyActivity to plugin.data and save to data.json.
 * The store IS the in-memory source of truth, so plugin.data and the store
 * cannot disagree — no safety guards needed.
 */
async function saveDataToJSON(plugin: KeepTheRhythm) {
	const dailyActivity = useStore.getState().dailyActivity;

	plugin.data.stats = {
		...plugin.data.stats,
		dailyActivity,
	};

	await plugin.saveData(plugin.data);
}

/**
 * Immediately flush in-memory data to data.json.
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
