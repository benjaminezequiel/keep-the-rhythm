import { getDateStreaks } from "@/utils/utils";
import { getDB } from "./db";
import { Language, Unit, TargetCount, CalculationType, NegativeWordCountMode } from "../defs/types";
import { formatDate } from "@/utils/dateUtils";
import { EVENTS, state } from "@/core/pluginState";
import {
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { sumTimeEntries, sumTimeEntriesWithMode } from "@/utils/utils";
import { DailyActivity } from "./types";
import { moment as _moment, debounce, Notice, Vault } from "obsidian";
import { getFileWordAndCharCount } from "@/utils/utils";
import { handleFileOpen } from "@/core/events";
const moment = _moment as unknown as typeof _moment.default;

export async function getActivityByDate(date: string) {
	return await getDB().dailyActivity.where("date").equals(date).toArray();
}

/** Expects that there is only one activity for that file */
// TODO: maybe I could check here if the file activity is duplicated to avoid errors.
export async function getActivtityForFile(date: string, filePath: string) {
	return await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([date, filePath])
		.first();
}

export async function getTotalValueByDate(
	date: string,
	unit: Unit,
): Promise<number> {
	const activities = await getDB()
		.dailyActivity.where("date")
		.equals(date)
		.toArray();

	let value = activities.reduce((sum, activity) => {
		return sum + sumTimeEntries(activity, unit, true);
	}, 0);

	return value || 0;
}

export async function getTotalValueInDateRange(
	startDate: string,
	endDate: string,
	unit: Unit,
) {
	const activities = await getDB()
		.dailyActivity.where("date")
		.between(startDate, endDate, true, true)
		.toArray();

	let value = activities.reduce((sum, activity) => {
		return sum + sumTimeEntries(activity, unit, true);
	}, 0);

	return value;
}

export async function getWordAndCharCountByTimeKey(date: string) {
	const activities = await getDB()
		.dailyActivity.where("date")
		.equals(date)
		.toArray();

	const timeKeyTotals: {
		[timeKey: string]: { totalWords: number; totalChars: number };
	} = {};

	for (const activity of activities) {
		for (const [timeKey, change] of Object.entries(activity.changes)) {
			if (!timeKeyTotals[timeKey]) {
				timeKeyTotals[timeKey] = { totalWords: 0, totalChars: 0 };
			}
			timeKeyTotals[timeKey].totalWords += change.w;
			timeKeyTotals[timeKey].totalChars += change.c;
		}
	}

	const result = Object.entries(timeKeyTotals)
		.map(([timeKey, { totalWords, totalChars }]) => ({
			timeKey,
			totalWords,
			totalChars,
		}))
		.sort((a, b) => a.timeKey.localeCompare(b.timeKey));

	return result;
}

export async function removeDuplicatedDailyEntries() {
	const allEntries = await getDB().dailyActivity.toArray();

	// Create a map to track unique entries by date+filePath
	const uniqueEntries = new Map();
	const duplicateIds = [];

	for (const entry of allEntries) {
		const key = `${entry.date}-${entry.filePath}`;

		if (!uniqueEntries.has(key)) {
			uniqueEntries.set(key, entry);
		} else {
			const existingEntry = uniqueEntries.get(key);

			for (const [key, change] of Object.entries(entry.changes)) {
				if (existingEntry.changes[key]) {
					existingEntry.changes[key].w += change.w;
					existingEntry.changes[key].c += change.c;
				} else {
					existingEntry.changes[key] = { ...change };
				}
			}

			if (entry.id !== undefined) {
				duplicateIds.push(entry.id);
			}
		}
	}

	// Update all the merged entries
	for (const entry of uniqueEntries.values()) {
		if (entry.id !== undefined) {
			await getDB().dailyActivity.update(entry.id, {
				changes: entry.changes,
			});
		}
	}

	// Delete all duplicates
	if (duplicateIds.length > 0) {
		await getDB().dailyActivity.bulkDelete(duplicateIds);
	}

	return {
		totalEntries: allEntries.length,
		uniqueEntries: uniqueEntries.size,
		duplicatesRemoved: duplicateIds.length,
	};
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

export async function getTotalValueFromLast24Hours(
	unit: Unit,
): Promise<number> {
	const activities = await getActivitiesFromLast24Hours();
	return sumLast24Hours(activities, unit);
}

export function sumLast24Hours(
	activities: DailyActivity[],
	unit: Unit,
	now: Date = new Date(),
): number {
	const cutoff = moment(now).subtract(24, "hours");

	let total = 0;

	for (const activity of activities) {
		if (!activity.changes) continue;

		for (const entry of activity.changes) {
			const fullDateTime = moment(`${activity.date}T${entry.timeKey}`);

			if (fullDateTime.isValid() && fullDateTime.isAfter(cutoff)) {
				total += unit === Unit.WORD ? entry.w : entry.c;
			}
		}
	}

	return total;
}

export async function getWholeVaultCount(
	unit: Unit,
	vault: Vault,
	enabledLanguages: Language[],
) {
	const needsRecalc =
		state.plugin.data.stats?.wholeVaultWordCount === undefined ||
		state.plugin.data.stats?.wholeVaultCharCount === undefined;

	if (needsRecalc) {
		if (!state.plugin.data.stats) {
			return 0;
		}
		// expensive!
		const files = vault.getMarkdownFiles();
		let wordSum = 0;
		let charSum = 0;

		for (let i = 0; i < files.length; i++) {
			const fileContent = await vault.cachedRead(files[i]);
			const [fileWordCount, fileCharCount] =
				await getFileWordAndCharCount(fileContent, enabledLanguages);
			wordSum += fileWordCount;
			charSum += fileCharCount;
		}
		state.plugin.data.stats.wholeVaultWordCount = wordSum;
		state.plugin.data.stats.wholeVaultCharCount = charSum;
	}

	// get base count + activity changes
	const baseCount =
		unit === Unit.CHAR
			? state.plugin.data.stats?.wholeVaultCharCount
			: state.plugin.data.stats?.wholeVaultWordCount;
	if (!baseCount) return 0;

	return baseCount;
}

export async function getCurrentCount(
	unit: Unit,
	target: TargetCount,
	calc?: CalculationType,
): Promise<number> {
	if (target === TargetCount.CURRENT_FILE) {
		if (state.currentActivity) {
			return sumTimeEntries(state?.currentActivity, unit) || 0;
		} else {
			// No current session - just sum all past activity for this file
			const activeFile = state.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				const activities = await getDB()
					.dailyActivity.where("filePath")
					.equals(activeFile.path)
					.toArray();
				return activities.reduce((sum, activity) => {
					return sum + sumTimeEntries(activity, unit, false);
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
			return await getTotalValueByDate(state.today, unit);

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
			return getTotalValueFromLast24Hours(unit);
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

		case TargetCount.WHOLE_VAULT:
			return await getWholeVaultCount(
				unit,
				state.plugin.app.vault,
				state.plugin.data.settings.enabledLanguages,
			);

		default:
			console.info(target);
			throw new Error("Unsupported target type");
	}

	const value = await getTotalValueInDateRange(startDate, state.today, unit);
	return calc === CalculationType.AVG ? Math.round(value / totalDays) : value;
}

export const deleteActivityById = async (entryId: number | undefined) => {
	if (!entryId) return;
	getDB().dailyActivity.delete(entryId);
};

export const deleteActivityFromDate = async (
	filePath: string,
	date: string,
) => {
	if (filePath == state.currentActivity?.filePath) {
		state.setCurrentActivity(null);
	}

	const entry = await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([date, filePath])
		.first();

	if (entry?.id) {
		getDB().dailyActivity.delete(entry.id);
		state.emit(EVENTS.REFRESH_EVERYTHING);
	} else {
		const notice = new Notice(
			"Failed to delete this entry! This is a bug, contact the developer.",
		);
	}
};

export async function getTotalValueByDateWithMode(
	date: string,
	unit: Unit,
	mode: NegativeWordCountMode
): Promise<number> {
	const activities = await getDB()
		.dailyActivity.where("date")
		.equals(date)
		.toArray();

	if (mode === NegativeWordCountMode.NET) {
		let value = activities.reduce((sum, activity) => {
			return sum + sumTimeEntries(activity, unit, true);
		}, 0);
		return value ?? 0;
	} else {
		// For Gross we need to sum individually
		let totalAdded = 0;

		for (const activity of activities) {
			// mode will be GROSS
			const res = sumTimeEntriesWithMode(activity, unit, NegativeWordCountMode.GROSS, true);
			if (typeof res === 'number') {
				totalAdded += res;
			}
		}

		return totalAdded;
	}
}

export async function getCurrentCountWithMode(
	unit: Unit,
	target: TargetCount,
	calc: CalculationType = CalculationType.TOTAL,
	mode: NegativeWordCountMode = NegativeWordCountMode.NET
): Promise<number | string> {
	if (target === TargetCount.CURRENT_FILE) {
		if (state.currentActivity) {
			return sumTimeEntriesWithMode(state?.currentActivity, unit, mode) || 0;
		} else {
			const activeFile = state.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				const activities = await getDB()
					.dailyActivity.where("filePath")
					.equals(activeFile.path)
					.toArray();

				if (mode === NegativeWordCountMode.NET) {
					return activities.reduce((sum, activity) => {
						return sum + sumTimeEntries(activity, unit, false);
					}, 0);
				} else {
					// Aggregate Gross
					let totalAdded = 0;
					for (const activity of activities) {
						// mode is GROSS
						const res = sumTimeEntriesWithMode(activity, unit, NegativeWordCountMode.GROSS, false);
						if (typeof res === 'number') {
							totalAdded += res;
						}
					}
					return totalAdded;
				}
			}
			return 0;
		}
	}

	if (target === TargetCount.CURRENT_DAY) {
		return await getTotalValueByDateWithMode(state.today, unit, mode);
	}


	// If mode is NET, just use old function
	if (mode === NegativeWordCountMode.NET) {
		return getCurrentCount(unit, target, calc);
	}

	// GROSS mode support for ranges
	if (mode === NegativeWordCountMode.GROSS) {
		let startDate: string;
		let endDate = state.today;

		switch (target) {
			case TargetCount.CURRENT_WEEK:
				startDate = formatDate(getStartOfWeek(new Date()));
				break;
			case TargetCount.CURRENT_MONTH:
				startDate = formatDate(getStartOfMonth(new Date()));
				break;
			case TargetCount.CURRENT_YEAR:
				startDate = formatDate(getStartOfYear(new Date()));
				break;
			case TargetCount.LAST_DAY:
				// Last 24h is special
				return getCurrentCount(unit, target, calc); // Fallback for last 24h to Net for now
			case TargetCount.LAST_WEEK:
				startDate = moment(state.today).subtract(7, "days").format("YYYY-MM-DD");
				break;
			case TargetCount.LAST_MONTH:
				startDate = moment(state.today).subtract(30, "days").format("YYYY-MM-DD");
				break;
			case TargetCount.LAST_YEAR:
				startDate = moment(state.today).subtract(365, "days").format("YYYY-MM-DD");
				break;
			default:
				return getCurrentCount(unit, target, calc);
		}

		// Fetch all activities in range and sum added
		const activities = await getDB()
			.dailyActivity.where("date")
			.between(startDate, endDate, true, true)
			.toArray();

		let totalAdded = 0;
		activities.forEach(act => {
			const res = sumTimeEntriesWithMode(act, unit, NegativeWordCountMode.GROSS, true);
			if (typeof res === 'number') totalAdded += res;
		});

		// Average calculation
		if (calc === CalculationType.AVG) {
			const totalDays = moment(endDate).diff(startDate, 'days') + 1;
			return Math.round(totalAdded / totalDays);
		}

		return totalAdded;
	}

	return getCurrentCount(unit, target, calc);
}
