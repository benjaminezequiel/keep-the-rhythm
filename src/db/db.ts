import Dexie from "dexie";
import { state } from "@/core/pluginState";
import { DailyActivity } from "./types";
import { getVaultKey, hashString } from "@/utils/utils";

class KTRDatabase extends Dexie {
	dailyActivity!: Dexie.Table<DailyActivity, number>;

	// It's necessary to add an unique identifier to the vault
	// indexedDB is shared across the same electron app, otherwise different vaults
	// would share the db and explode!

	constructor(vaultKey: string) {
		super(`KTRDatabase-${hashString(vaultKey)}`);

		this.version(2).stores({
			dailyActivity:
				"++id, date, filePath, [date+filePath], [filePath+date]",
		});
	}
}

let dbInstance: KTRDatabase | null = null;

// Need to init the database onload() so that the plugin instance already exists
export async function initDatabase() {
	if (!dbInstance) {
		dbInstance = new KTRDatabase(getVaultKey(state.plugin.app.vault));
		await getDB().dailyActivity.clear();
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

export function closeDB() {
	dbInstance?.close();
	dbInstance = null;
}
