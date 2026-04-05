import { ManualEntryModal } from "./ui/components/ManualEntry";
import {
  Plugin,
  TFile,
  TAbstractFile,
  Notice,
  moment as _moment,
} from "obsidian";

import {
  ColorConfig,
  DEFAULT_SETTINGS,
  STARTING_STATS,
  PluginData,
} from "@/defs/types";

import { getDB, initDatabase } from "@/db/db";
import { EVENTS, state } from "@/core/pluginState";
import { PluginView, VIEW_TYPE } from "@/ui/views/PluginView";
import { migrateDataFromOldFormat } from "@/utils/migrateData";
import { SettingsTab } from "@/ui/settings/SettingsTab";

import { formatDate, scheduleNextDayTrigger } from "@/utils/dateUtils";

import * as utils from "@/utils/utils";
import * as events from "@/core/events";
import * as codeBlocks from "@/core/codeBlocks";
import { checkPreviousStreak, activateSidebarView } from "@/core/commands";

const moment = _moment as unknown as typeof _moment.default;

export default class KeepTheRhythm extends Plugin {
  data: PluginData = {
    schema: "0.2",
    settings: DEFAULT_SETTINGS,
    stats: {
      dailyActivity: [],
    },
  };

  private dayTimer: number | null = null;
  private JSON_DEBOUNCE_TIME = 1000;
  private LAST_BREAKING_CHANGE_TO_SCHEMA = "0.2";

  private JsonDebounceTimeout: any = null;

  async onload() {
    state.setPlugin(this);
    this.dayTimer = scheduleNextDayTrigger(() => {
      this.updateAndSaveEverything(); // or just refresh heatmap
    });

    initDatabase();

    // todo: check if this is really necessary
    getDB().dailyActivity.clear(); // restarts DB to ensure data.json is the source of truth

    /////////
    const loadedData = await this.loadData();

    if (loadedData) {
      // add setting to remove backups
      try {
        await this.backupDataToVaultFolder(loadedData);
      } catch (err) {
        console.error("KTR Error trying to create backup: ", err);
      }
    }

    /** Data is only loaded into dexie if it's the correct schema */
    if (
      loadedData &&
      loadedData.schema == this.LAST_BREAKING_CHANGE_TO_SCHEMA
    ) {
      await this.initializeDataFromJSON(loadedData);
    } else if (
      loadedData &&
      loadedData.schema !== this.LAST_BREAKING_CHANGE_TO_SCHEMA
    ) {
      new Notice("KTR: Migrating data from previous versions...");
      await this.migrateDataFromJSON(loadedData);
    } else if (!loadedData) {
      this.data.schema = this.LAST_BREAKING_CHANGE_TO_SCHEMA;
      this.data.stats = {
        ...STARTING_STATS,
      };
    } else {
      this.data.stats = loadedData.stats;
      this.data.settings = loadedData.settings;
    }

    await this.saveData(this.data);

    // #endregion

    state.setToday();

    this.checkVaultCountStaleness();

    // /** Set of utility functions that registers required objects and sets plugin state */

    /** Initialize SIDEBAR view */
    this.registerView(VIEW_TYPE, (leaf) => {
      return new PluginView(leaf, this);
    });

    this.initializeCommands();
    this.initializeEvents();
    this.applyColorStyles();
    this.addSettingTab(new SettingsTab(this.app, this));

    /** Registers CUSTOM CODE BLOCKS */
    this.registerMarkdownCodeBlockProcessor(
      "ktr-heatmap",
      codeBlocks.createHeatmapCodeBlock,
    );

    this.registerMarkdownCodeBlockProcessor(
      "ktr-slots",
      codeBlocks.createSlotsCodeBlock,
    );

    this.registerMarkdownCodeBlockProcessor(
      "ktr-entries",
      codeBlocks.createEntriesCodeBlock,
    );

    state.on(EVENTS.REFRESH_EVERYTHING, async () => {
      if (this.JsonDebounceTimeout) {
        clearTimeout(this.JsonDebounceTimeout);
      }

      this.JsonDebounceTimeout = setTimeout(async () => {
        await this.saveDataToJSON();
      }, this.JSON_DEBOUNCE_TIME);
    });
  }

  private async checkVaultCountStaleness() {
    if (
      this.data.stats?.wholeVaultWordCount !== undefined &&
      this.data.stats?.wholeVaultCharCount !== undefined
    ) {
      const recentActivity = await getDB()
        .dailyActivity.orderBy("date")
        .reverse()
        .first();

      if (recentActivity) {
        const daysSinceLastActivity = moment().diff(
          moment(recentActivity.date),
          "days",
        );
        if (daysSinceLastActivity > 7) {
          this.data.stats.wholeVaultWordCount = undefined;
          this.data.stats.wholeVaultCharCount = undefined;
          await this.saveData(this.data);
        }
      }
    }
  }
  private async backupDataToVaultFolder(data: any) {
    const backupConfig =
      data.settings.backupConfig || this.data.settings.backupConfig;

    // Check if backups are enabled
    if (!backupConfig.enabled) {
      console.log("KTR: Backups disabled, ignoring");
      return;
    }

    const folderPath = backupConfig.folderPath || ".keep-the-rhythm";
    const fileName = `backup-${formatDate(new Date())}-${data.schema}.json`;
    const backupPath = `${folderPath}/${fileName}`;
    const jsonData = JSON.stringify(data, null, 2);

    const folderExists = await this.app.vault.adapter.exists(folderPath);

    if (!folderExists) {
      await this.app.vault.adapter.mkdir(folderPath);
    }

    const filesOnBackupsFolder = await this.app.vault.adapter.list(folderPath);
    const backupFiles = filesOnBackupsFolder.files.filter((f) =>
      f.endsWith(".json"),
    );

    // Clean backups based on user preference
    const maxBackups = backupConfig.maxNumberOfBackups || 3;
    if (backupFiles.length >= maxBackups) {
      await this.cleanOlderBackups(backupFiles, maxBackups);
    }

    console.log(backupPath);
    // This if runs if the user has data from previous schemas, checking
    // every backup to see if the data was already backed up and saving it otherwise.
    if (data.schema !== "0.3") {
      // Compare against all existing backups
      for (const filePath of backupFiles) {
        try {
          if (!(await this.app.vault.adapter.exists(filePath))) {
            console.error("File does not exist:", filePath);
            return;
          }
          const contents = await this.app.vault.adapter.read(filePath);
          if (contents && contents === jsonData) {
            return;
          }
        } catch (err) {
          console.error("Failed to read file:", filePath, err);
          return null;
        }
      }
      // No identical backup found, save new one
      await this.app.vault.adapter.write(backupPath, jsonData);
      new Notice("KTR: New backup saved.");
    } else {
      await this.app.vault.adapter.write(backupPath, jsonData);
      new Notice("KTR: First backup created.");
    }
  }

  private async cleanOlderBackups(backupPaths: string[], maxBackups: number) {
    const now = window.moment();

    // Sort backups by date (newest first)
    const backupsWithDates = backupPaths
      .map((fullPath) => {
        const fileName = fullPath.split("/").pop();
        if (!fileName) return null;

        // Match: backup-YYYY-MM-DD(-optionalSchema).json
        const match = fileName.match(
          /^backup-(\d{4}-\d{2}-\d{2})(?:-[\w\d.]+)?\.json$/,
        );
        if (!match) return null;

        const dateStr = match[1];
        const fileDate = window.moment(dateStr, "YYYY-MM-DD", true);

        if (!fileDate.isValid()) {
          console.warn(`Skipping file with invalid date: ${fileName}`);
          return null;
        }

        return { fullPath, fileName, fileDate };
      })
      .filter((item) => item !== null)
      .sort((a, b) => b!.fileDate.valueOf() - a!.fileDate.valueOf());

    // Keep only the most recent maxBackups, delete the rest
    for (let i = maxBackups; i < backupsWithDates.length; i++) {
      const backup = backupsWithDates[i];
      if (!backup) continue;

      const fileExists = await this.app.vault.adapter.exists(backup.fullPath);
      if (!fileExists) {
        console.warn(`File already missing: ${backup.fullPath}`);
        continue;
      }

      await this.app.vault.adapter.remove(backup.fullPath);
      console.log(`Deleted old backup: ${backup.fileName}`);
    }
  }

  private async migrateDataFromJSON(loadedData: any) {
    const previousStats = migrateDataFromOldFormat(loadedData);
    this.data.stats = previousStats.stats;
    this.data.schema = "0.2";

    if (this.data.stats) {
      await getDB().dailyActivity.bulkAdd(this.data.stats.dailyActivity);
    }
  }

  private async initializeDataFromJSON(loadedData: PluginData) {
    if (loadedData.settings) {
      this.data.settings = {
        ...DEFAULT_SETTINGS,
        ...loadedData.settings,
      };
    }
    if (loadedData.stats) {
      this.data.stats = loadedData.stats;
      await checkPreviousStreak();

      const dailyActivitiesFromJSON = this.data.stats?.dailyActivity || [];

      try {
        /** BulkPut updates the records if they already exist! */
        await getDB().dailyActivity.bulkPut(dailyActivitiesFromJSON);
      } catch (error) {
        console.error(
          "Failed loading some data, contact the developer.",
          error,
        );
      }
    }
  }

  public applyColorStyles() {
    const containerStyle = this.app.workspace.containerEl.style;
    let light = undefined;
    let dark = undefined;

    if (this.data.settings?.heatmapConfig?.colors) {
      light = this.data.settings.heatmapConfig.colors?.light;
      dark = this.data.settings.heatmapConfig.colors?.dark;
    }

    if (light && dark) {
      for (let i = 0; i <= 4; i++) {
        const key = i as keyof ColorConfig;
        containerStyle.setProperty(`--light-${i}`, light[key]);
        containerStyle.setProperty(`--dark-${i}`, dark[key]);
      }
    }
  }

  private initializeCommands() {
    this.addRibbonIcon("calendar-days", "Keep the Rhythm", () => {
      activateSidebarView();
    });

    this.addCommand({
      id: "open-keep-the-rhythm",
      name: "Open sidebar view",
      callback: () => {
        activateSidebarView();
      },
    });

    this.addCommand({
      id: "add-ktr-manual-entry",
      name: "Add manual entry",
      callback: () => {
        new ManualEntryModal(state.plugin.app).open();
      },
    });

    this.addCommand({
      id: "check-ktr-streak",
      name: "Check writing goal from previous days",
      callback: () => {
        checkPreviousStreak();
      },
    });
  }

  private initializeEvents() {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        events.handleEditorChange(editor, info, this);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (file instanceof TFile) events.handleFileDelete(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        if (file instanceof TFile) events.handleFileCreate(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) events.handleFileRename(file, oldPath);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) events.handleFileOpen(file);
      }),
    );
  }

  // #endregion

  // #region Unloading

  async onunload() {
    events.cleanDBTimeout();

    if (this.dayTimer !== null) {
      window.clearTimeout(this.dayTimer);
    }

    if (this.JsonDebounceTimeout) {
      clearTimeout(this.JsonDebounceTimeout);
    }
    this.saveDataToJSON();
    this.backupDataToVaultFolder(this.data);

    await getDB().dailyActivity.clear();
  }

  // #endregion

  async onExternalSettingsChange() {
    try {
      const newData = (await this.loadData()) as PluginData;

      if (JSON.stringify(newData) == JSON.stringify(this.data)) {
        return;
      }

      newData.stats?.dailyActivity.forEach(async (activity, index) => {
        let existingActivity;

        if (activity.id) {
          existingActivity = await getDB().dailyActivity.get(activity.id);
        }

        /** Find any new activity and add it to the db */
        if (
          existingActivity &&
          JSON.stringify(existingActivity) == JSON.stringify(activity)
        ) {
          return;
        } else {
          getDB().dailyActivity.put(activity);
        }
      });

      /** Assign new external settings*/
      if (this.data.settings !== newData.settings) {
        this.data.settings = {
          ...DEFAULT_SETTINGS,
          ...newData.settings,
        };
      }

      state.emit(EVENTS.REFRESH_EVERYTHING);
      //TODO: ADD "SAVE AND UPDATE" HERE + EMIT UPDATE TO PLUGIN STATE
    } catch (error) {
      console.error("Error in onExternalSettingsChange:", error);
    }
  }

  // #region SAVING DATA

  private async saveDataToJSON() {
    const dailyActivityDB = await getDB().dailyActivity.toArray();

    this.data.stats = {
      ...this.data.stats,
      dailyActivity: dailyActivityDB,
    };

    await this.saveData(this.data);
  }

  public async updateCurrentStreak(increase: boolean) {
    if (!this.data.stats) return;

    // TODO: check previous date to see when was the last one

    if (!this.data.stats.daysWithCompletedGoal) {
      this.data.stats.daysWithCompletedGoal = [];
    }

    const { longestStreak, currentStreak } = utils.getDateStreaks(
      this.data.stats.daysWithCompletedGoal,
    );

    if (increase) {
      if (this.data.stats.daysWithCompletedGoal.includes(state.today)) {
        return;
      }
      this.data.stats.daysWithCompletedGoal.push(state.today);
    } else {
      if (this.data.stats.daysWithCompletedGoal.includes(state.today)) {
        const newArray = this.data.stats.daysWithCompletedGoal?.filter(
          (item) => item !== state.today,
        );
        this.data.stats.daysWithCompletedGoal = newArray;
      }
    }
    this.quietSave();
  }

  public async updateAndSaveEverything() {
    await this.saveData(this.data);
    state.setToday(); // already refreshes everything
  }

  public async quietSave() {
    await this.saveData(this.data);
  }

  // #endregion
}
