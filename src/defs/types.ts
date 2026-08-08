/**
 * Virtual activity row: the "object-shaped" view of a (date, filePath)
 * activity entry used by the UI and the codeblock query engine.  It is
 * never stored as-is; the persisted form is numeric maps (see
 * `DayActivityMap` / `PersistedBaselines` below) encoded by statsCodec.ts.
 */
export interface ActivityRecord {
	date: string;
	filePath: string;
	wordsAdded: number;
}

/**
 * One day's activity in memory/on disk: filePath -> words added that day.
 */
export type DayActivityMap = Record<string, number>;

/**
 * All activity days keyed by date (docs: today included).  The date's map
 * is the same shape regardless of whether it is today or a past day —
 * nothing distinguishes "live" rows at the storage level; the live anchor
 * (starting word count) lives separately in `todayBaselines`.
 */
export type DaysMap = Record<string, DayActivityMap>;

/**
 * Persisted baselines for the CURRENT day only (`stats.todayBaselines`).
 *
 * The baseline of a file is its word count at the first moment it was
 * touched today; live deltas are computed as `editorCount - baseline`.
 * Once a day rolls over the baselines become dead weight and are
 * discarded (`day` lets the loader detect a stale copy, e.g. when the
 * app slept through midnight).
 */
export interface PersistedBaselines {
	/** Date the baselines were recorded. */
	day: string;
	/** filePath -> initial word count of the file for that day. */
	baselines: Record<string, number>;
}

/**
 * Legacy v1.x row shape. Only read during migration to the `days` format.
 */
export interface LegacyActivityData {
	date: string;
	filePath: string;
	wordCountStart: number;
	wordsAdded: number;
}

export enum CalculationType {
	TOTAL = "TOTAL",
	AVG = "AVG",
}

export type Language =
	| "LATIN"
	| "CJK"
	| "JAPANESE"
	| "KOREAN"
	| "CYRILLIC"
	| "GREEK"
	| "ARABIC"
	| "HEBREW"
	| "INDIC"
	| "SOUTHEAST_ASIAN";

export interface IntensityConfig {
	low: number;
	medium: number;
	high: number;
}

export interface ColorConfig {
	0: string;
	1: string;
	2: string;
	3: string;
	4: string;
}

export interface ThemeColors {
	light: ColorConfig;
	dark: ColorConfig;
}

export enum TargetCount {
	CURRENT_STREAK = "CURRENT_STREAK", // not done yet
	CURRENT_DAY = "CURRENT_DAY", // Add progress bar towards daily goal
	CURRENT_WEEK = "CURRENT_WEEK",
	CURRENT_MONTH = "CURRENT_MONTH",
	CURRENT_YEAR = "CURRENT_YEAR",
	LAST_DAY = "LAST_DAY",
	LAST_WEEK = "LAST_WEEK",
	LAST_MONTH = "LAST_MONTH",
	LAST_YEAR = "LAST_YEAR",
}

export enum HeatmapColorModes {
	STOPS = "stops",
	GRADUAL = "gradual",
	SOLID = "solid",
	LIQUID = "liquid",
}

export interface Settings {
	dailyWritingGoal: number; // created as setting, not used anywhere yet
	/**
	 * Debounce delay for sampling editor content on keystroke, in seconds.
	 * After the user stops typing for this long, the current editor state
	 * is read and word deltas are computed.
	 */
	editorChangeSampleDelay: number;
	enabledLanguages: Language[]; // guides the definition of REGEXes for word counting
	/**
	 * Optional list of folder path prefixes. When non-empty, only files whose
	 * path equals one of these prefixes or starts with `<prefix>/` are
	 * tracked. Leave empty to track the whole vault (default behaviour).
	 */
	trackedFolders?: string[];
	startOfTheWeek: "MONDAY" | "SUNDAY"; // not used yet, should be used to offset start of the week calculations and heatmap
	heatmapConfig: HeatmapConfig;
	heatmapNavigation: boolean;

	backupConfig: {
		enabled: boolean;
		maxNumberOfBackups: number;
		folderPath: string;
	};

	sidebarConfig: {
		visibility: {
			showSlots: boolean;
			showHeatmap: boolean;
			showEntries: boolean;
		};
		slots: SlotConfig[];
	};
}

export interface SlotConfig {
	index: number;
	option: TargetCount;
	calc: CalculationType;
}

export interface PluginData {
	settings: Settings;
	migratedPreviousVersion?: boolean;
	schema?: "0.2" | "0.3" | string;
	stats?: {
		/**
		 * date -> filePath -> words added that day. Includes the current
		 * day; yesterday-and-older rows only carry the added count (the
		 * per-file wordCountStart lives exclusively in `todayBaselines`).
		 */
		days?: Record<string, DayActivityMap>;
		/** Baselines for today's live files (see PersistedBaselines). */
		todayBaselines?: PersistedBaselines;
		/** Legacy v1.x storage — migrated into `days` on load. */
		dailyActivity?: LegacyActivityData[];
	};
}

export const STARTING_STATS = {
	days: {},
};

export interface HeatmapConfig {
	numberOfWeeks?: number;
	intensityMode: HeatmapColorModes;
	roundCells: boolean;
	hideMonthLabels: boolean;
	hideWeekdayLabels: boolean;
	alignLeft: boolean;
	startDate?: string;
	intensityStops: {
		low: number;
		medium: number;
		high: number;
	};
	colors?: {
		light: ColorConfig;
		dark: ColorConfig;
	};
}
export const DEFAULT_SETTINGS: Settings = {
	enabledLanguages: ["LATIN"],
	dailyWritingGoal: 500,
	editorChangeSampleDelay: 2,
	trackedFolders: [],
	startOfTheWeek: "SUNDAY",
	heatmapNavigation: true,
	heatmapConfig: {
		roundCells: true,
		hideMonthLabels: false,
		hideWeekdayLabels: false,
		alignLeft: false,
		numberOfWeeks: 52,
		intensityMode: HeatmapColorModes.GRADUAL,
		intensityStops: {
			low: 100,
			medium: 500,
			high: 1000,
		},
		colors: {
			light: {
				0: "#e0e0e0",
				1: "#9be9a8",
				2: "#6ad286",
				3: "#2ebd54",
				4: "#12a53e",
			},
			dark: {
				0: "#ebedf015",
				1: "#0e4429",
				2: "#006d32",
				3: "#26a641",
				4: "#39d353",
			},
		},
	},
	sidebarConfig: {
		visibility: {
			showSlots: true,
			showEntries: true,
			showHeatmap: true,
		},
		slots: [
			{
				index: 0,
				option: TargetCount.CURRENT_DAY,
				calc: CalculationType.TOTAL,
			},
			{
				index: 1,
				option: TargetCount.CURRENT_WEEK,
				calc: CalculationType.TOTAL,
			},
			{
				index: 2,
				option: TargetCount.LAST_MONTH,
				calc: CalculationType.AVG,
			},
		],
	},
	backupConfig: {
		enabled: true,
		folderPath: ".keep-the-rhythm",
		maxNumberOfBackups: 3,
	},
};
