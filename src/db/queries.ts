import { getDateStreaks, sumTimeEntries } from "@/utils/utils";
import { getDB } from "./db";
import { TargetCount, CalculationType } from "../defs/types";
import { formatDate } from "@/utils/dateUtils";
import { useStore } from "@/core/store";
import { getPlugin } from "@/core/pluginRegistry";
import {
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { DailyActivity } from "./types";
import { moment as _moment, Notice } from "obsidian";

const moment = _moment as unknown as typeof _moment.default;

/**
 * Context for getCurrentCount.  React components pass store selector
 * values so useLiveQuery can depend on them; non-React callers omit
 * and the function falls back to useStore.getState().
 */
export interface QueryContext {
	today: string;
	currentActivity: DailyActivity | null;
	daysWithCompletedGoal: string[];
}

export async function getActivityByDate(date: string) {
	return await getDB().dailyActivity.where("date").equals(date).toArray();
}

export async function getActivityByDateAndFile(date: string, filePath: string) {
	return await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([date, filePath])
		.first();
}

export async function getTotalValueByDate(date: string): Promise<number> {
	const activities = await getDB()
		.dailyActivity.where("date")
		.equals(date)
		.toArray();

	let value = activities.reduce((sum, activity) => {
		return sum + (activity.wordsAdded || 0);
	}, 0);

	return value || 0;
}

export async function getTotalValueInDateRange(
	startDate: string,
	endDate: string,
) {
	const activities = await getDB()
		.dailyActivity.where("date")
		.between(startDate, endDate, true, true)
		.toArray();

	let value = activities.reduce((sum, activity) => {
		return sum + (activity.wordsAdded || 0);
	}, 0);

	return value;
}


export async function getActivitiesFromLast24Hours(): Promise<DailyActivity[]> {
	const now = moment();
	const yesterday = now.clone().subtract(1, "day").format("YYYY-MM-DD");
	const today = now.format("YYYY-MM-DD");

	const yesterdayActivities = await getDB()
		.dailyActivity.where("date")
		.equals(yesterday)
		.toArray();

	const todayActivities = await getDB()
		.dailyActivity.where("date")
		.equals(today)
		.toArray();

	return [...yesterdayActivities, ...todayActivities];
}

export async function getTotalValueFromLast24Hours(): Promise<number> {
	const activities = await getActivitiesFromLast24Hours();
	return sumLast24Hours(activities);
}

export function sumLast24Hours(
	activities: DailyActivity[],
	now: Date = new Date(),
): number {
	const cutoff = moment(now).subtract(24, "hours").format("YYYY-MM-DD");

	let total = 0;

	for (const activity of activities) {
		if (activity.date >= cutoff) {
			total += activity.wordsAdded || 0;
		}
	}

	return total;
}

export async function getCurrentCount(
	target: TargetCount,
	calc?: CalculationType,
	ctx?: QueryContext,
): Promise<number> {
	// Fall back to store when no context is provided (non-React callers).
	const { today, currentActivity, daysWithCompletedGoal } =
		ctx ?? useStore.getState();

	if (target === TargetCount.CURRENT_FILE) {
		if (currentActivity) {
			return sumTimeEntries(currentActivity) || 0;
		} else {
			const activeFile = getPlugin().app.workspace.getActiveFile();
			if (activeFile) {
				const activities = await getDB()
					.dailyActivity.where("filePath")
					.equals(activeFile.path)
					.toArray();
				return activities.reduce((sum, activity) => {
					return sum + sumTimeEntries(activity);
				}, 0);
			}
			return 0;
		}
	}

	let startDate: string;
	let totalDays: number;

	switch (target) {
		case TargetCount.CURRENT_STREAK:
			if (daysWithCompletedGoal?.length) {
				const { currentStreak } = getDateStreaks(daysWithCompletedGoal);
				return currentStreak;
			} else {
				return 0;
			}

		case TargetCount.CURRENT_DAY:
			return await getTotalValueByDate(today);

		case TargetCount.CURRENT_WEEK:
			startDate = formatDate(getStartOfWeek(new Date()));
			totalDays = moment(today).diff(startDate, "days") + 1;
			break;

		case TargetCount.CURRENT_MONTH:
			startDate = formatDate(getStartOfMonth(new Date()));
			totalDays = moment(today).diff(startDate, "days") + 1;
			break;

		case TargetCount.CURRENT_YEAR:
			startDate = formatDate(getStartOfYear(new Date()));
			totalDays =
				Math.floor(
					(new Date(today).getTime() -
						new Date(startDate).getTime()) /
						(1000 * 3600 * 24),
				) + 1;
			break;

		case TargetCount.LAST_DAY:
			return getTotalValueFromLast24Hours();

		case TargetCount.LAST_WEEK:
			startDate = moment(today)
				.subtract(7, "days")
				.format("YYYY-MM-DD");
			totalDays = 7;
			break;

		case TargetCount.LAST_MONTH:
			startDate = moment(today)
				.subtract(30, "days")
				.format("YYYY-MM-DD");
			totalDays = 30;
			break;

		case TargetCount.LAST_YEAR:
			startDate = moment(today)
				.subtract(365, "days")
				.format("YYYY-MM-DD");
			totalDays = 365;
			break;

		default:
			console.info(target);
			throw new Error("Unsupported target type");
	}

	const value = await getTotalValueInDateRange(startDate, today);
	return calc === CalculationType.AVG ? Math.round(value / totalDays) : value;
}

export const deleteActivityFromDate = async (
	filePath: string,
	date: string,
) => {
	const store = useStore.getState();
	if (filePath == store.currentActivity?.filePath) {
		store.setCurrentActivity(null);
	}

	try {
		await getDB()
			.dailyActivity.where("[date+filePath]")
			.equals([date, filePath])
			.delete();
		// DB row removed → request JSON persist.  useLiveQuery in Slot /
		// Entries auto-responds to the DB mutation, so no manual UI event
		// is needed.  If currentActivity was just nullified, Slot's store
		// selector picks that up automatically.
		store.requestPersist();
	} catch {
		new Notice(
			"Failed to delete this entry! This is a bug, contact the developer.",
		);
	}
};

/**
 * Applies `wordsDelta` to the given activity's DB row. Callers (e.g.
 * ManualEntry modal) should NOT request persist themselves after calling
 * this — it's handled here so the data layer is the single source of truth.
 *
 * The DB mutation is picked up automatically by useLiveQuery in Slot /
 * Entries / Heatmap, so no manual UI event is needed.  We only request
 * JSON persist so the change eventually lands in data.json.
 */
export async function addDeltaToActivity(
	dailyActivity: DailyActivity,
	wordsDelta: number,
) {
	await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([dailyActivity.date, dailyActivity.filePath])
		.modify((selectedEntry) => {
			selectedEntry.wordsAdded = (selectedEntry.wordsAdded || 0) + wordsDelta;
		});

	useStore.getState().requestPersist();
}