import Dexie from "dexie";
import { getPlugin } from "@/core/pluginRegistry";
import { DailyActivity } from "./types";

class KTRDatabase extends Dexie {
	dailyActivity!: Dexie.Table<DailyActivity, [string, string]>;

	// It's necessary to add the vault name to the plugin DB because
	// indexedDB is shared across the same electron app

	constructor(vaultName: string) {
		super(`KTRDatabase-${vaultName}`);

		this.version(3).stores({
			dailyActivity:
				"[date+filePath], date, filePath, [filePath+date]",
		});
	}
}

let dbInstance: KTRDatabase | null = null;

// Need to init the database onload() so that the plugin instance already exists
export async function initDatabase() {
	const vaultName = getPlugin().app.vault.getName();
	try {
		dbInstance = new KTRDatabase(vaultName);
		await dbInstance.open();
		await dbInstance.dailyActivity.clear();
	} catch (error: any) {
		if (error?.name === 'UpgradeError' || error?.name === 'VersionError') {
			await Dexie.delete(`KTRDatabase-${vaultName}`);
			dbInstance = new KTRDatabase(vaultName);
			await dbInstance.open();
			await dbInstance.dailyActivity.clear();
		} else {
			throw error;
		}
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
