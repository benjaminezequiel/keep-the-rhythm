export interface SettingItem {
  key: string;
  type: "toggle" | "number" | "dropdown" | "custom";
  title: string;
  description?: string;
  placeholder?: string;
  dependsOn?: string[];
  visibleWhen?: Record<string, any>;
}

export interface SettingsSection {
  id: string;
  title: string;
  settings: SettingItem[];
}

export type SettingsSchema = {
  sections: SettingsSection[];
};

export const SETTINGS_SCHEMA: SettingsSchema = {
  sections: [
    {
      id: "general",
      title: "General",
      settings: [
        {
          key: "enabledLanguages",
          type: "custom",
          title: "Enabled Languages",
          description: "Select which writing systems to count.",
        },
        {
          key: "dailyWritingGoal",
          type: "number",
          title: "Writing Goal",
          description: "Amount of words you intend to write on a day.",
          placeholder: "500",
        },
      ],
    },
    {
      id: "heatmaps",
      title: "Heatmaps",
      settings: [
        {
          key: "heatmapNavigation",
          type: "toggle",
          title: "Heatmap navigation",
          description:
            "Clicks open the daily note from that day, using Obsidian's Daily Note core plugin.",
        },
        {
          key: "heatmapConfig.roundCells",
          type: "toggle",
          title: "Rounded Cells",
          description: "Render heatmap cells with rounded corners.",
        },
        {
          key: "heatmapConfig.hideMonthLabels",
          type: "toggle",
          title: "Hide Month Labels",
          description: "Hide month labels above the heatmap.",
        },
        {
          key: "heatmapConfig.hideWeekdayLabels",
          type: "toggle",
          title: "Hide Weekday Labels",
          description: "Hide weekday labels on the heatmap.",
        },
        {
          key: "heatmapConfig.intensityMode",
          type: "custom",
          title: "Coloring Mode",
          description: "Choose the coloring method.",
        },
        {
          key: "heatmapConfig.intensityStops",
          type: "custom",
          title: "Intensity thresholds",
          description: "Changes how the color of each cell is calculated.",
        },
        {
          key: "heatmapConfig.colors[light]",
          type: "custom",
          title: "Light Theme Colors",
          description:
            "Colors used to paint each cell, ranges vary based on coloring mode.",
        },
        {
          key: "heatmapConfig.colors[dark]",
          type: "custom",
          title: "Dark Theme Colors",
          description:
            "Colors used to paint each cell, ranges vary based on coloring mode.",
        },
      ],
    },
    {
      id: "sidebar",
      title: "Sidebar",
      settings: [
        {
          key: "sidebarConfig.visibility.showSlots",
          type: "toggle",
          title: "Show overview",
          description:
            "Display the overview section in the word count heatmap.",
        },
        {
          key: "sidebarConfig.visibility.showEntries",
          type: "toggle",
          title: "Show today's entries",
          description:
            "Display which files were edited today and their respective word counts.",
        },
        {
          key: "sidebarConfig.visibility.showHeatmap",
          type: "toggle",
          title: "Show heatmap",
          description: "Displays a heatmap with historic writing data.",
        },
      ],
    },
    {
      id: "backup",
      title: "Backup",
      settings: [
        {
          key: "backupConfig.enabled",
          type: "toggle",
          title: "Backup historic data on load",
          description: "Enables periodic backups to prevent data loss.",
        },
      ],
    },
  ],
};
