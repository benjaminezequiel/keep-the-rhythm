import { getDateStreaks, sumTimeEntries } from "@/utils/utils";
import { getDB } from "./db";
import { TargetCount, CalculationType } from "../defs/types";
import { formatDate } from "@/utils/dateUtils";
import { EVENTS, state } from "@/core/pluginState";
import {
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { DailyActivity } from "./types";
import { moment as _moment, Notice } from "obsidian";

const moment = _moment as unknown as typeof _moment.default;

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
): Promise<number> {
	if (target === TargetCount.CURRENT_FILE) {
		if (state.currentActivity) {
			return sumTimeEntries(state?.currentActivity) || 0;
		} else {
			const activeFile = state.plugin.app.workspace.getActiveFile();
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
			// return state.plugin.data?.stats?.currentStreak || 0;
			if (state.plugin.data.stats?.daysWithCompletedGoal) {
				const { currentStreak } = getDateStreaks(
					state.plugin.data.stats?.daysWithCompletedGoal,
				);
				return currentStreak;
			} else {
				return 0;
			}

		case TargetCount.CURRENT_DAY:
			return await getTotalValueByDate(state.today);

		case TargetCount.CURRENT_WEEK:
			startDate = formatDate(getStartOfWeek(new Date()));
			totalDays = moment(state.today).diff(startDate, "days") + 1;
			break;

		case TargetCount.CURRENT_MONTH:
			startDate = formatDate(getStartOfMonth(new Date()));
			totalDays = moment(state.today).diff(startDate, "days") + 1;
			break;

		case TargetCount.CURRENT_YEAR:
			startDate = formatDate(getStartOfYear(new Date()));
			totalDays =
				Math.floor(
					(new Date(state.today).getTime() -
						new Date(startDate).getTime()) /
						(1000 * 3600 * 24),
				) + 1;
			break;

		case TargetCount.LAST_DAY:
			return getTotalValueFromLast24Hours();
			break;

		case TargetCount.LAST_WEEK:
			startDate = moment(state.today)
				.subtract(7, "days")
				.format("YYYY-MM-DD");
			totalDays = 7;
			break;

		case TargetCount.LAST_MONTH:
			startDate = moment(state.today)
				.subtract(30, "days")
				.format("YYYY-MM-DD");
			totalDays = 30;
			break;

		case TargetCount.LAST_YEAR:
			startDate = moment(state.today)
				.subtract(365, "days")
				.format("YYYY-MM-DD");
			totalDays = 365;
			break;

		default:
			console.info(target);
			throw new Error("Unsupported target type");
	}

	const value = await getTotalValueInDateRange(startDate, state.today);
	return calc === CalculationType.AVG ? Math.round(value / totalDays) : value;
}

export const deleteActivityFromDate = async (
	filePath: string,
	date: string,
) => {
	if (filePath == state.currentActivity?.filePath) {
		state.setCurrentActivity(null);
	}

	try {
		await getDB()
			.dailyActivity.where("[date+filePath]")
			.equals([date, filePath])
			.delete();
		state.emit(EVENTS.REFRESH_EVERYTHING);
	} catch {
		const notice = new Notice(
			"Failed to delete this entry! This is a bug, contact the developer.",
		);
	}
};

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
}