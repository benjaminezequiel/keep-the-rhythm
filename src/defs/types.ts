import { DailyActivity } from "@/db/types";

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

export enum Unit {
  CHAR = "CHAR",
  WORD = "WORD",
}

export enum TargetCount {
  CURRENT_FILE = "CURRENT_FILE",
  CURRENT_STREAK = "CURRENT_STREAK", // not done yet
  CURRENT_DAY = "CURRENT_DAY", // Add progress bar towards daily goal
  CURRENT_WEEK = "CURRENT_WEEK",
  CURRENT_MONTH = "CURRENT_MONTH",
  CURRENT_YEAR = "CURRENT_YEAR",
  LAST_DAY = "LAST_DAY",
  LAST_WEEK = "LAST_WEEK",
  LAST_MONTH = "LAST_MONTH",
  LAST_YEAR = "LAST_YEAR",
  WHOLE_VAULT = "WHOLE_VAULT", // not done yet
  // THIS_FOLDER = "THIS_FOLDER", //not done yet
}

export enum HeatmapColorModes {
  STOPS = "stops",
  GRADUAL = "gradual",
  SOLID = "solid",
  LIQUID = "liquid",
}

export interface Settings {
  dailyWritingGoal: number; // created as setting, not used anywhere yet
  enabledLanguages: Language[]; // guides the definition of REGEXes for word counting
  globalFilter?: string; // not used yet
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
  unit: Unit;
  calc: CalculationType;
}

export interface PluginData {
  settings: Settings;
  migratedPreviousVersion?: boolean;
  schema?: "0.2" | "0.3" | string;
  stats?: {
    currentStreak?: number;
    highestStreak?: number;
    highestStreakStartDate?: string;
    highestStreakEndDate?: string;
    daysWithCompletedGoal?: string[];
    dailyActivity: DailyActivity[];
    wholeVaultWordCount?: number;
    wholeVaultCharCount?: number;
  };
}

export const STARTING_STATS = {
  currentStreak: 0,
  highestStreak: 0,
  highestStreakStartDate: "",
  highestStreakEndDate: "",
  daysWithCompletedGoal: [],
  dailyActivity: [],
};

export interface HeatmapConfig {
  numberOfWeeks?: number;
  intensityMode: HeatmapColorModes;
  roundCells: boolean;
  hideMonthLabels: boolean;
  hideWeekdayLabels: boolean;
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
  startOfTheWeek: "SUNDAY",
  heatmapNavigation: true,
  heatmapConfig: {
    roundCells: true,
    hideMonthLabels: false,
    hideWeekdayLabels: false,
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
        unit: Unit.WORD,
        calc: CalculationType.TOTAL,
      },
      {
        index: 1,
        option: TargetCount.CURRENT_WEEK,
        unit: Unit.WORD,
        calc: CalculationType.TOTAL,
      },
      {
        index: 2,
        option: TargetCount.LAST_MONTH,
        unit: Unit.WORD,
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
