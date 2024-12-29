import {
  debounce,
  Plugin,
  TFile,
  TAbstractFile,
  MarkdownView,
  ItemView,
  setIcon,
} from "obsidian";
import { v4 as uuidv4 } from "uuid";

import { WordCountView, VIEW_TYPE } from "./src/views/WordCountView";
import { WordCountData } from "src/types";
import "./styles.css";
import { IntensityConfig, ColorConfig } from "src/types";
import { SettingsTab } from "./src/views/SettingsTab";

interface PluginSettings {
  intensityLevels: IntensityConfig;
  showOverview: boolean;
  colors: {
    light: ColorConfig;
    dark: ColorConfig;
  };
}

export const DEFAULT_SETTINGS: PluginSettings = {
  intensityLevels: {
    low: 100,
    medium: 500,
    high: 1000,
  },
  colors: {
    light: {
      level0: "#ebedf015",
      level1: "#9be9a8",
      level2: "#40c463",
      level3: "#30a14e",
      level4: "#216e39",
    },
    dark: {
      level0: "#161b22",
      level1: "#0e4429",
      level2: "#006d32",
      level3: "#26a641",
      level4: "#39d353",
    }
  },
  showOverview: true,
};

export default class WordCountPlugin extends Plugin {
  private debouncedHandleModify: (file: TFile) => void;
  data: WordCountData;
  viewData: WordCountData;
  private deviceId: string;
  settings: PluginSettings;
  private view: WordCountView | null = null;

  private getDeviceId(): string {
    let deviceId = localStorage.getItem("word-count-device-id");
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem("word-count-device-id", deviceId);
    }
    return deviceId;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData({
      intensityLevels: this.settings.intensityLevels,
      showOverview: this.settings.showOverview,
      colors: this.settings.colors,
    });
    const allDevicesData = await this.loadAllDevicesData();
    this.viewData = this.mergeDevicesData(allDevicesData);
    this.view?.refresh();
  }

  private createSettingsTab() {
    this.addSettingTab(
      new SettingsTab(this.app, this, {
        intensityLevels: this.settings.intensityLevels,
        showOverview: this.settings.showOverview,
        colors: this.settings.colors,
        onIntensityLevelsChange: (newLevels) => {
          this.settings.intensityLevels = newLevels;
          this.saveSettings();
        },
        onShowOverviewChange: (newShowOverview) => {
          this.settings.showOverview = newShowOverview;
          this.saveSettings();
        },
        onColorsChange: (newColors) => {
          this.settings.colors = newColors;
          this.applyColorStyles();
          this.saveSettings();
        },
      })
    );
  }
  

  private getDeviceDataPath(): string {
    return `data/device-${this.getDeviceId()}.json`;
  }

  private getCurrentDate(): string {
    return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  }

  getWordCount(text: string): number {
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  private async initializeData() {
    const localData = await this.loadDeviceData();
    if (!localData) {
      this.data = {
        deviceId: this.getDeviceId(),
        dailyCounts: {},
      };
      await this.saveDeviceData(this.data);
    } else {
      this.data = localData;
    }

    const allDevicesData = await this.loadAllDevicesData();
    this.viewData = this.mergeDevicesData(allDevicesData);
  }

  private applyColorStyles() {
    let styleEl = document.getElementById("word-count-heatmap-colors");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "word-count-heatmap-colors";
      document.head.appendChild(styleEl);
    }
  
    const lightColors = this.settings.colors.light;
    const darkColors = this.settings.colors.dark;
    
    styleEl.textContent = `
      .theme-light {
        --level-0-color: ${lightColors.level0};
        --level-1-color: ${lightColors.level1};
        --level-2-color: ${lightColors.level2};
        --level-3-color: ${lightColors.level3};
        --level-4-color: ${lightColors.level4};
      }
      
      .theme-dark {
        --level-0-color: ${darkColors.level0};
        --level-1-color: ${darkColors.level1};
        --level-2-color: ${darkColors.level2};
        --level-3-color: ${darkColors.level3};
        --level-4-color: ${darkColors.level4};
      }
    `;
  }

  async activateView() {
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(VIEW_TYPE).length > 0) {
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE,
        active: true,
      });
    }
  }

  async onload() {
    await this.loadSettings();
    this.createSettingsTab();
    await this.initializeData();
    this.applyColorStyles();

    this.registerView(VIEW_TYPE, (leaf) => {
      this.view = new WordCountView(leaf, this);
      return this.view;
    });

    this.addRibbonIcon("calendar-days", "Word Count Stats", () => {
      this.activateView();
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        const view = leaf.view;
        if (view instanceof MarkdownView) {
          const file = view.file;
          if (file instanceof TFile) {
            this.handleFileOpen(file);
          }
        }
      }),
    );

    this.debouncedHandleModify = debounce(
      (file: TFile) => this.handleFileModify(file),
      1000,
      false,
    );

    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.debouncedHandleModify(file);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
          this.handleFileRename(file, oldPath);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.handleFileDelete(file);
        }
      }),
    );
  }

  private async handleFileRename(file: TFile, oldPath: string) {
    if (!file || file.extension !== "md") {
      return;
    }

    try {
      const date = this.getCurrentDate();

      if (this.data.dailyCounts[date]?.files?.[oldPath]) {
        const fileData = this.data.dailyCounts[date].files[oldPath];

        this.data.dailyCounts[date].files[file.path] = fileData;
        delete this.data.dailyCounts[date].files[oldPath];

        await this.saveDeviceData(this.data);
      }
    } catch (error) {
      console.error("Error in handleFileRename:", error);
    }
  }

  private async handleFileOpen(file: TFile) {
    if (!file || file.extension !== "md") {
      return;
    }

    try {
      const date = this.getCurrentDate();
      const content = await this.app.vault.read(file);
      const initialWordCount = this.getWordCount(content);

      if (!this.data) {
        return;
      }

      if (!this.data.dailyCounts[date]) {
        this.data.dailyCounts[date] = {
          totalDelta: 0,
          files: {},
        };
      }

      if (!this.data.dailyCounts[date].files[file.path]) {
        this.data.dailyCounts[date].files[file.path] = {
          initial: initialWordCount,
          current: initialWordCount,
        };
        await this.saveDeviceData(this.data);
        const allDevicesData = await this.loadAllDevicesData();
        this.viewData = this.mergeDevicesData(allDevicesData);
        this.view?.refresh();
      }
    } catch (error) {
      console.error("Error in handleFileOpen:", error);
    }
  }

  async onunload() {}

  private async saveDeviceData(data: WordCountData) {
    try {
      const dataDir = this.app.vault.configDir;

      try {
        await this.app.vault.adapter.mkdir(dataDir);
      } catch (dirError) {
        if (
          !(dirError instanceof Error) ||
          !dirError.message.includes("File exists")
        ) {
          throw dirError;
        }
      }

      const filePath = `${dataDir}/keep-the-rhythm-device-${this.getDeviceId()}.json`;

      await this.app.vault.adapter.write(
        filePath,
        JSON.stringify(data, null, 2),
      );
    } catch (error) {
      console.error("Error saving device data:", error);
    }
  }

  private async loadAllDevicesData(): Promise<WordCountData[]> {
    try {
      const dataDir = this.app.vault.configDir;
      const files = await this.app.vault.adapter.list(dataDir);
      const deviceFiles = files.files.filter(
        (f) =>
          f.startsWith(`${dataDir}/keep-the-rhythm-device-`) &&
          f.endsWith(".json"),
      );

      const allData: WordCountData[] = [];
      for (const file of deviceFiles) {
        try {
          const content = await this.app.vault.adapter.read(file);
          allData.push(JSON.parse(content));
        } catch (fileError) {
          console.error(`Error reading device file ${file}:`, fileError);
        }
      }
      return allData;
    } catch (error) {
      console.error("Error loading all devices data:", error);
      return [];
    }
  }

  private mergeDevicesData(allDevicesData: WordCountData[]): WordCountData {
    const mergedData: WordCountData = {
      deviceId: this.getDeviceId(),
      dailyCounts: {},
    };

    const allDates = new Set<string>();
    allDevicesData.forEach((deviceData) => {
      Object.keys(deviceData.dailyCounts).forEach((date) => {
        allDates.add(date);
      });
    });

    allDates.forEach((date) => {
      mergedData.dailyCounts[date] = {
        totalDelta: 0,
        files: {},
      };

      allDevicesData.forEach((deviceData) => {
        const dayData = deviceData.dailyCounts[date];
        if (dayData) {
          mergedData.dailyCounts[date].totalDelta += dayData.totalDelta || 0;

          Object.entries(dayData.files || {}).forEach(
            ([filePath, fileData]) => {
              const existingFileData =
                mergedData.dailyCounts[date].files[filePath];

              if (!existingFileData) {
                mergedData.dailyCounts[date].files[filePath] = { ...fileData };
              } else {
                if (fileData.current > existingFileData.current) {
                  mergedData.dailyCounts[date].files[filePath] = {
                    ...fileData,
                  };
                }
              }
            },
          );
        }
      });
    });

    return mergedData;
  }

  private async loadDeviceData(): Promise<WordCountData | null> {
    try {
      const path = `${this.app.vault.configDir}/keep-the-rhythm-device-${this.getDeviceId()}.json`;
      const exists = await this.app.vault.adapter.exists(path);

      if (exists) {
        const content = await this.app.vault.adapter.read(path);
        return JSON.parse(content);
      }
      return null;
    } catch (error) {
      console.error("Error loading device data:", error);
      return null;
    }
  }

  private async handleFileDelete(file: TFile) {
    if (!file || file.extension !== "md") {
      return;
    }

    try {
      const date = this.getCurrentDate();

      if (this.data.dailyCounts[date]?.files?.[file.path]) {
        const fileData = this.data.dailyCounts[date].files[file.path];
        const lastWordCount = fileData.current;
        const initialWordCount = fileData.initial;

        const fileDelta = lastWordCount - initialWordCount;
        this.data.dailyCounts[date].totalDelta -= fileDelta;

        this.data.dailyCounts[date].files[file.path].current = 0;

        await this.saveDeviceData(this.data);
        const allDevicesData = await this.loadAllDevicesData();
        this.viewData = this.mergeDevicesData(allDevicesData);
        this.view?.refresh();
      }
    } catch (error) {
      console.error("Error in handleFileDelete:", error);
    }
  }

  private async handleFileModify(file: TFile) {
    if (!file || file.extension !== "md") {
      return;
    }

    try {
      const date = this.getCurrentDate();

      if (!this.data.dailyCounts[date]?.files?.[file.path]) {
        await this.handleFileOpen(file);
        return;
      }

      const content = await this.app.vault.read(file);
      const currentWordCount = this.getWordCount(content);

      const previousCount =
        this.data.dailyCounts[date].files[file.path].current;
      const delta = currentWordCount - previousCount;

      this.data.dailyCounts[date].files[file.path].current = currentWordCount;
      this.data.dailyCounts[date].totalDelta += delta;

      await this.saveDeviceData(this.data);

      const allDevicesData = await this.loadAllDevicesData();
      this.viewData = this.mergeDevicesData(allDevicesData);
      this.view?.refresh();

    } catch (error) {
      console.error("Error in handleFileModify:", error);
    }
  }
}
