export interface FileWordCount {
  initial: number;
  current: number;
}

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

export interface DayData {
  totalDelta: number;
  files: {
    [filePath: string]: FileWordCount;
  };
}

export interface WordCountData {
  deviceId: string;
  dailyCounts: {
    [date: string]: DayData;
  };
}
