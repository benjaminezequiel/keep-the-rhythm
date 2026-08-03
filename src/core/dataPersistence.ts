import { PluginData } from "@/defs/types";
import { useStore } from "./store";
import { Plugin } from "obsidian";

const JSON_DEBOUNCE_TIME = 1000;

/**
 * Persist ALL in-memory state (settings, streak, dailyActivity) to
 * data.json.  Constructs the PluginData object directly from the store
 * — no intermediate staging buffer.
 */
async function saveDataToJSON(plugin: Plugin) {
	const { settings, dailyActivity } =
		useStore.getState();

	const data: PluginData = {
		schema: "1.0",
		settings,
		stats: {
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
	const { settings, dailyActivity } =
		useStore.getState();
	return {
		schema: "1.0",
		settings,
		stats: {
			dailyActivity,
		},
	};
}

/**
 * Holds the debounce and generation state for persistence scheduling.
 */
export interface PersistenceScheduler {
	dispose: () => void;
	/**
	 * Cancel any pending debounced save and write the in-memory store to
	 * data.json immediately.  Used by visibilitychange / pagehide handlers
	 * because requestAnimationFrame is paused in background tabs — without
	 * an explicit flush, a user who types and then switches apps for a while
	 * can lose their last few edits to an OS kill or hard reload.
	 */
	flushNow: () => Promise<void>;
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

	const flushNow = async () => {
		if (JsonDebounceTimeout) {
			clearTimeout(JsonDebounceTimeout);
			JsonDebounceTimeout = null;
		}
		_saveGen++; // invalidate any in-flight debounced save
		await saveDataToJSON(plugin);
	};

	return {
		dispose: () => {
			unsub();
			_saveGen++;
			clearTimeout(JsonDebounceTimeout);
			JsonDebounceTimeout = null;
		},
		flushNow,
	};
}
