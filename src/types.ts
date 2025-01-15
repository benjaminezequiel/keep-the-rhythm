export interface IntensityConfig {
	low: number;
	medium: number;
	high: number;
}

export interface ColorConfig {
	level0: string;
	level1: string;
	level2: string;
	level3: string;
	level4: string;
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
			level0: "#e0e0e0",
			level1: "#9be9a8",
			level2: "#6ad286",
			level3: "#2ebd54",
			level4: "#12a53e",
		},
		dark: {
			level0: "#ebedf015",
			level1: "#0e4429",
			level2: "#006d32",
			level3: "#26a641",
			level4: "#39d353",
		},
	},
	showOverview: true,
};
