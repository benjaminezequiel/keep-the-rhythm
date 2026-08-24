import Dexie from "dexie";
import { state } from "@/core/pluginState";
import { DailyActivity } from "./types";

class KTRDatabase extends Dexie {
	dailyActivity!: Dexie.Table<DailyActivity, number>;

	// It's necessary to add the vault name to the plugin DB because
	// indexedDB is shared across the same electron app

	constructor(vaultName: string) {
		super(`KTRDatabase-${vaultName}`);

		this.version(2).stores({
			dailyActivity:
				"++id, date, filePath, [date+filePath], [filePath+date]",
		});
	}
}

let dbInstance: KTRDatabase | null = null;

// Need to init the database onload() so that the plugin instance already exists
export function initDatabase() {
	if (!dbInstance) {
		const vaultName = state.plugin.app.vault.getName();
		dbInstance = new KTRDatabase(vaultName);
	}
}

export function getDB(): KTRDatabase {
	if (!dbInstance) {
		throw new Error(
			"Database not initialized. Call initDatabase() in onload().",
		);
	}
	return dbInstance;
}
