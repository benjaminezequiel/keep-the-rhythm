import { getDateStreaks } from "@/utils/utils";
import { db } from "./db";
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
import { moment as _moment, debounce, Notice, Vault } from "obsidian";
import { getFileWordAndCharCount } from "@/utils/utils";
import { handleFileOpen } from "@/core/events";
const moment = _moment as unknown as typeof _moment.default;

export async function getActivityByDate(date: string) {
	return await db.dailyActivity.where("date").equals(date).toArray();
}

/** Expects that there is only one activity for that file */
// TODO: maybe I could check here if the file activity is duplicated to avoid errors.
export async function getActivtityForFile(date: string, filePath: string) {
	return await db.dailyActivity
		.where("[date+filePath]")
		.equals([date, filePath])
		.first();
}

export async function getTotalValueByDate(
	date: string,
	unit: Unit,
): Promise<number> {
	const activities = await db.dailyActivity
		.where("date")
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
	const activities = await db.dailyActivity
		.where("date")
		.between(startDate, endDate, true, true)
		.toArray();

	let value = activities.reduce((sum, activity) => {
		return sum + sumTimeEntries(activity, unit, true);
	}, 0);

	return value;
}

export async function getWordAndCharCountByTimeKey(date: string) {
	const activities = await db.dailyActivity
		.where("date")
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
	const allEntries = await db.dailyActivity.toArray();

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
			await db.dailyActivity.update(entry.id, {
				changes: entry.changes,
			});
		}
	}

	// Delete all duplicates
	if (duplicateIds.length > 0) {
		await db.dailyActivity.bulkDelete(duplicateIds);
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

	const yesterdayActivities = await db.dailyActivity
		.where("date")
		.equals(yesterday)
		.toArray();

	const todayActivities = await db.dailyActivity
		.where("date")
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
	const files = vault.getMarkdownFiles();
	let sum = 0;

	for (let i = 0; i < files.length; i++) {
		const fileContent = await vault.cachedRead(files[i]);
		const [fileWordCount, fileCharCount] = await getFileWordAndCharCount(
			fileContent,
			enabledLanguages,
		);

		if (unit == Unit.CHAR) {
			sum += fileCharCount;
		} else {
			sum += fileWordCount;
		}
	}
	return sum;
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
			return await debouncedVaultCountRead(
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

let resolveQueue: ((v: number) => void)[] = [];
export async function debouncedVaultCountRead(
	unit: Unit,
	vault: Vault,
	enabledLanguages: Language[],
): Promise<number> {
	if (state.vaultReadTimeout) clearTimeout(state.vaultReadTimeout as any);

	const promise = new Promise<number>((resolve) => {
		resolveQueue.push(resolve);
	});

	state.setVaultReadTimeout(
		setTimeout(async () => {
			const value = await getWholeVaultCount(
				unit,
				vault,
				enabledLanguages,
			);
			state.setCurrentVaultCount(value);
			resolveQueue.forEach((res) => res(value));
			resolveQueue = [];
			state.setVaultReadTimeout(null);
		}, state.DEBOUNCE_VAULT_READ) as any,
	);
	return promise;
}

export const deleteActivityById = async (entryId: number | undefined) => {
	if (!entryId) return;
	db.dailyActivity.delete(entryId);
};

export const deleteActivityFromDate = async (
	filePath: string,
	date: string,
) => {
	if (filePath == state.currentActivity?.filePath) {
		state.setCurrentActivity(null);
	}

	const entry = await db.dailyActivity
		.where("[date+filePath]")
		.equals([date, filePath])
		.first();

	if (entry?.id) {
		db.dailyActivity.delete(entry.id);
		state.emit(EVENTS.REFRESH_EVERYTHING);
	} else {
		const notice = new Notice(
			"Failed to delete this entry! This is a bug, contact the developer.",
		);
	}
};
