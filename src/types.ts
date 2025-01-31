export type ScriptName =
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
	level_0: string;
	level_1: string;
	level_2: string;
	level_3: string;
	level_4: string;
}

export interface ThemeColors {
	light: ColorConfig;
	dark: ColorConfig;
}

export interface FileWordCount {
	initial: number;
	current: number;
}

export interface Stats {
	[date: string]: {
		totalDelta: number;
		files: {
			[filePath: string]: FileWordCount;
		};
	};
}

export interface deviceStats {
	[deviceId: string]: Stats;
}

export interface PluginSettings {
	enabledScripts: ScriptName[];
	intensityLevels: IntensityConfig;
	showOverview: boolean;
	colors: {
		light: ColorConfig;
		dark: ColorConfig;
	};
}

export interface PluginData {
	settings: PluginSettings;
	devices: deviceStats;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	intensityLevels: {
		low: 100,
		medium: 500,
		high: 1000,
	},
	colors: {
		light: {
			level_0: "#e0e0e0",
			level_1: "#9be9a8",
			level_2: "#6ad286",
			level_3: "#2ebd54",
			level_4: "#12a53e",
		},
		dark: {
			level_0: "#ebedf015",
			level_1: "#0e4429",
			level_2: "#006d32",
			level_3: "#26a641",
			level_4: "#39d353",
		},
	},
	showOverview: true,
	enabledScripts: ["LATIN"] as ScriptName[],
};
