import { TimeEntry } from "./types";
import { getCurrentTimeKey } from "@/utils/dateUtils";
import { getDateStreaks } from "@/utils/utils";
import { getDB } from "./db";
import { Language, Unit, TargetCount, CalculationType } from "../defs/types";
import { formatDate } from "@/utils/dateUtils";
import { EVENTS, state } from "@/core/pluginState";
import {
	getStartOfMonth,
	getStartOfWeek,
	getStartOfYear,
} from "@/utils/dateUtils";
import { sumTimeEntries } from "@/utils/utils";
import { DailyActivity } from "./types";
import { moment as _moment, Notice, Vault } from "obsidian";
import { getFileWordAndCharCount } from "@/utils/utils";
import { getTrackedCounts, forgetFile } from "@/core/activityTracker";
import { getLanguageBasedWordCount } from "@/core/wordCounting";

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

	const value = activities.reduce((sum, activity) => {
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

	const value = activities.reduce((sum, activity) => {
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
	const uniqueEntries = new Map<string, DailyActivity>();
	const duplicateIds: number[] = [];

	for (const entry of allEntries) {
		const key = `${entry.date}-${entry.filePath}`;

		if (!uniqueEntries.has(key)) {
			uniqueEntries.set(key, entry);
		} else {
			const existingEntry = uniqueEntries.get(key);
			if (!existingEntry) continue;

			for (const change of entry.changes ?? []) {
				const existingChange = existingEntry.changes?.find(
					(item) => item.timeKey === change.timeKey,
				);
				if (existingChange) {
					existingChange.w += change.w;
					existingChange.c += change.c;
				} else {
					existingEntry.changes = [
						...(existingEntry.changes ?? []),
						{ ...change },
					];
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
		const activeFile = state.plugin.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") return 0;

		// handleEditorChange already computed this from the live editor
		const tracked = getTrackedCounts(activeFile.path);
		if (tracked) return unit === Unit.CHAR ? tracked.chars : tracked.words;

		// File open but never edited this session
		const content = await state.plugin.app.vault.cachedRead(activeFile);
		return unit === Unit.CHAR
			? content.length
			: getLanguageBasedWordCount(
					content,
					state.plugin.data.settings.enabledLanguages,
				);
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
			throw new Error("Unsupported target type");
	}

	const value = await getTotalValueInDateRange(startDate, state.today, unit);
	return calc === CalculationType.AVG ? Math.round(value / totalDays) : value;
}

export const deleteActivityById = async (entryId: number | undefined) => {
	if (!entryId) return;

	const entry = await getDB().dailyActivity.get(entryId);
	await getDB().dailyActivity.delete(entryId);

	if (entry) forgetFile(entry.filePath, entry.date);
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
		await getDB().dailyActivity.delete(entry.id);
		forgetFile(filePath, date);
		state.emit(EVENTS.REFRESH_EVERYTHING);
	} else {
		new Notice(
			"Failed to delete this entry! This is a bug, contact the developer.",
		);
	}
};

export async function addDeltaToActivity(
	dailyActivity: DailyActivity,
	wordsDelta: number,
	charsDelta: number,
) {
	const currentTimeKey = getCurrentTimeKey();

	await getDB()
		.dailyActivity.where("[date+filePath]")
		.equals([dailyActivity.date, dailyActivity.filePath])
		.modify((selectedEntry) => {
			const lastTimeEntry =
				selectedEntry.changes[selectedEntry.changes.length - 1];
			const lastTimeKey = lastTimeEntry?.timeKey; // If there is no last key, a new one is gonna be created anyway

			// If timekey is updated (snaps to last 5min)
			// Then we just add the delta to it
			// Otherwise create new entry

			if (lastTimeKey == currentTimeKey) {
				const existingIndex = selectedEntry.changes.findIndex(
					(e) => e.timeKey === lastTimeKey,
				);

				// add the recieved delta to the existing delta
				selectedEntry.changes[existingIndex] = {
					timeKey: lastTimeKey,
					w: wordsDelta + lastTimeEntry.w,
					c: charsDelta + lastTimeEntry.c,
				};
			}
			if (lastTimeKey !== currentTimeKey) {
				const newEntry: TimeEntry = {
					timeKey: currentTimeKey,
					w: wordsDelta,
					c: charsDelta,
				};

				selectedEntry.changes.push(newEntry);
			}
		});
}
