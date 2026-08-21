import { TFile } from "obsidian";
import { DailyActivity } from "@/db/types";
import { state } from "@/core/pluginState";
import { getExistingOrCreateNewEntry } from "@/utils/utils";
import { getLanguageBasedWordCount } from "@/core/wordCounting";
import { formatDate } from "@/utils/dateUtils";

export type Counts = { words: number; chars: number };

const activities = new Map<string, DailyActivity>();

const inFlight = new Map<string, Promise<DailyActivity>>();

const lastCounts = new Map<string, Counts>();

const keyFor = (filePath: string, date: string = state.today) =>
	`${date}:${filePath}`;

export async function readCounts(file: TFile): Promise<Counts> {
	const content = await state.plugin.app.vault.read(file);
	return {
		words: getLanguageBasedWordCount(
			content,
			state.plugin.data.settings.enabledLanguages,
		),
		chars: content.length,
	};
}

/**
 * Returns the activity for the file on the current day, creating it if needed.
 */
export async function resolveActivity(
	file: TFile,
	seed?: Counts,
): Promise<DailyActivity> {
	const key = keyFor(file.path);

	if (seed && !lastCounts.has(key)) {
		lastCounts.set(key, seed);
	}

	const cached = activities.get(key);
	if (cached) return cached;

	const pending = inFlight.get(key);
	if (pending) return pending;

	const promise = (async () => {
		const activity = await getExistingOrCreateNewEntry(file, state.today);
		activities.set(key, activity);

		if (!lastCounts.has(key)) {
			lastCounts.set(key, await readCounts(file));
		}

		return activity;
	})().finally(() => inFlight.delete(key));

	inFlight.set(key, promise);
	return promise;
}

/**
 * Records the file's new counts and returns the delta since the previous call.
 */
export function takeDelta(
	file: TFile,
	words: number,
	chars: number,
): { wordsAdded: number; charsAdded: number } {
	const key = keyFor(file.path);
	const prev = lastCounts.get(key) ?? { words, chars };

	lastCounts.set(key, { words, chars });

	return { wordsAdded: words - prev.words, charsAdded: chars - prev.chars };
}

/**
 * Drops the cached row so the next resolve re-reads it from the DB.
 */
export function invalidateActivity(
	filePath: string,
	date: string = state.today,
) {
	const key = keyFor(filePath, date);
	activities.delete(key);
	inFlight.delete(key);
}

/** Called on day change and on unload. */
export function invalidateAll() {
	activities.clear();
	inFlight.clear();
	lastCounts.clear();
}

export function renameTrackedPath(oldPath: string, newPath: string) {
	for (const map of [activities, lastCounts] as Map<string, unknown>[]) {
		for (const key of [...map.keys()]) {
			const [date, ...rest] = key.split(":");
			if (rest.join(":") !== oldPath) continue;

			const value = map.get(key)!;
			map.delete(key);
			map.set(`${date}:${newPath}`, value);
		}
	}

	const cached = activities.get(keyFor(newPath));
	if (cached) cached.filePath = newPath;
}

export function checkDayChange(): boolean {
	const actualToday = formatDate(new Date());
	if (actualToday === state.today) return false;

	state.setToday();
	invalidateAll();
	state.setCurrentActivity(null);
	return true;
}

export function forgetFile(filePath: string, date: string = state.today) {
	const key = keyFor(filePath, date);
	activities.delete(key);
	inFlight.delete(key);
	lastCounts.delete(key);
}

export function getTrackedCounts(
	filePath: string,
	date: string = state.today,
): Counts | undefined {
	return lastCounts.get(keyFor(filePath, date));
}
