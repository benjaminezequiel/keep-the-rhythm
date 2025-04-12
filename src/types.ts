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

export interface Settings {
	enabledLanguages: Language[];
	intensityStops: IntensityConfig;
	sidePanelConfig: {
		showOverview: boolean;
		showHeatmap: boolean;
		showEntries: boolean;
	};
	colors?: {
		light: ColorConfig;
		dark: ColorConfig;
	};
}

export interface PluginData {
	settings: Settings;
	stats?: {
		fileStats: {};
		dailyActivity: {};
	};
}

export const DEFAULT_SETTINGS: Settings = {
	enabledLanguages: ["LATIN"],
	intensityStops: {
		low: 100,
		medium: 500,
		high: 1000,
	},
	sidePanelConfig: {
		showOverview: true,
		showEntries: true,
		showHeatmap: true,
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
};
