import { DEFAULT_SETTINGS, PluginData } from "@/defs/types";
import { useStore } from "./store";
import { Plugin } from "obsidian";

const JSON_DEBOUNCE_TIME = 1000;

/**
 * Persist ALL in-memory state (settings, streak, dailyActivity) to
 * data.json.  Constructs the PluginData object directly from the store
 * — no intermediate staging buffer.
 */
async function saveDataToJSON(plugin: Plugin) {
	const { settings, daysWithCompletedGoal, dailyActivity } =
		useStore.getState();

	const data: PluginData = {
		schema: "1.0",
		settings,
		stats: {
			daysWithCompletedGoal,
			dailyActivity,
		},
	};

	await plugin.saveData(data);
}

/**
 * Build a PluginData snapshot from the current in-memory store state.
 * Used for backup during unload.
 */
export function buildSnapshotFromStore(): PluginData {
	const { settings, daysWithCompletedGoal, dailyActivity } =
		useStore.getState();
	return {
		schema: "1.0",
		settings,
		stats: {
			daysWithCompletedGoal,
			dailyActivity,
		},
	};
}

/**
 * Immediately flush in-memory data to data.json.
 * Used during plugin unload to ensure data is persisted before teardown.
 */
export async function flushToJSON(plugin: Plugin) {
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
	plugin: Plugin,
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
