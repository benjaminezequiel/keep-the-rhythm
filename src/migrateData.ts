import { db } from "./db";

export async function migrateFromJSON(json: any) {
	for (const [deviceId, dates] of Object.entries(json.devices)) {
		for (const [date, dayData] of Object.entries<any>(dates as any)) {
			for (const [filePath, stats] of Object.entries<any>(
				dayData.files,
			)) {
				const wordsWritten = stats.current - stats.initial;
				const charsWritten = 0;
				const filename = filePath.split("/").pop() ?? "";
				const lastModified = new Date(date);

				// Add to dailyActivity
				await db.dailyActivity.add({
					date,
					filePath,
					device: deviceId,
					wordsWritten,
					charsWritten,
					created: stats.initial === 0,
				});
			}
		}
	}
}
