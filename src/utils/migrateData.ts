import { DEFAULT_SETTINGS, PluginData } from "../defs/types";
import { TimeEntry, DailyActivity } from "../db/types";

export type OldFormat = {
  settings: {
    intensityLevels: {
      low: number;
      medium: number;
      high: number;
    };
    colors: {
      light: Record<string, string>;
      dark: Record<string, string>;
    };
    showOverview: boolean;
    showEntries: boolean;
    showHeatmap: boolean;
    enabledScripts: string[];
  };
  devices: {
    [deviceId: string]: {
      [date: string]: {
        files: {
          [filePath: string]: {
            initial: number;
            current: number;
          };
        };
        totalDelta: number;
      };
    };
  };
};

export function migrateDataFromOldFormat(oldData: OldFormat): PluginData {
  const newFormat: PluginData = {
    settings: DEFAULT_SETTINGS,
    stats: {
      dailyActivity: [],
    },
  };

  const activityMap = new Map<string, DailyActivity>();
  const wordCountByDate = new Map<string, number>();

  for (const deviceId in oldData.devices) {
    const device = oldData.devices[deviceId];

    for (const date in device) {
      const dayData = device[date];
      let dailyTotal = 0;

      // Simple check: if files object exists and has any keys, process files only
      const hasFileEntries =
        dayData.files && Object.keys(dayData.files).length > 0;

      if (hasFileEntries) {
        // Process individual files, ignore totalDelta

        for (const filePath in dayData.files) {
          const fileData = dayData.files[filePath];
          const wordDelta = fileData.current - fileData.initial;

          if (wordDelta === 0) continue;

          dailyTotal += wordDelta;
          const activityKey = `${date}-${filePath}`;

          if (activityMap.has(activityKey)) {
            const existingActivity = activityMap.get(activityKey)!;
            existingActivity.changes[0].w += wordDelta;
          } else {
            const change: TimeEntry = {
              timeKey: "12:00",
              w: wordDelta,
              c: 0,
            };

            const activity: DailyActivity = {
              date,
              filePath,
              wordCountStart: fileData.initial,
              charCountStart: 0,
              changes: [change],
            };

            activityMap.set(activityKey, activity);
          }
        }
      } else if (dayData.totalDelta > 0) {
        // No files or empty files object, but has totalDelta - create recovered-file

        const recoveredFilePath = "recovered-file";
        const activityKey = `${date}-${recoveredFilePath}`;

        const change: TimeEntry = {
          timeKey: "12:00",
          w: dayData.totalDelta,
          c: 0,
        };

        const activity: DailyActivity = {
          date,
          filePath: recoveredFilePath,
          wordCountStart: 0,
          charCountStart: 0,
          changes: [change],
        };

        activityMap.set(activityKey, activity);
        dailyTotal += dayData.totalDelta;
      }

      // Accumulate word count for this date
      const existingCount = wordCountByDate.get(date) || 0;
      wordCountByDate.set(date, existingCount + dailyTotal);
    }
  }

  const completedDates = Array.from(wordCountByDate.entries())
    .filter(([_, count]) => count >= DEFAULT_SETTINGS.dailyWritingGoal)
    .map(([date]) => date);

  newFormat.stats!.dailyActivity = Array.from(activityMap.values());
  newFormat.stats!.daysWithCompletedGoal = completedDates;

  return newFormat;
}
