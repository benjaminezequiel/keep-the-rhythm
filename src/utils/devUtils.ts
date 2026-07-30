import { DailyActivity } from "@/db/types";
import { getDB } from "@/db/db";

export async function mockMonthDailyActivity() {
	const today = new Date();
	const activities: DailyActivity[] = [];

	for (let i = 0; i < 365; i++) {
		const day = new Date(today);
		day.setDate(today.getDate() - i);

		const dateStr = day.toISOString().split("T")[0]; // YYYY-MM-DD

		const sessions = Math.floor(Math.random() * 5 + 1);
		let wordsAdded = 0;
		for (let j = 0; j < sessions; j++) {
			wordsAdded += Math.floor(Math.random() * 100);
		}

		const rand = Math.random();
		let filePath: string;
		if (rand < 0.33) {
			filePath = `mock/path/file-${i}.md`;
		} else if (rand < 0.66) {
			filePath = `data/${dateStr}/activity.md`;
		} else {
			filePath = `archives/${day.getFullYear()}/${day.getMonth() + 1}/day-${day.getDate()}-mock.md`;
		}

		activities.push({
			date: dateStr,
			filePath,
			wordCountStart: 0,
			wordsAdded,
		});
	}

	await getDB().dailyActivity.bulkAdd(activities);
}
