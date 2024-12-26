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
  colors: ColorConfig;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  intensityLevels: {
    low: 100,
    medium: 500,
    high: 1000,
  },
  colors: {
    level0: "#ebedf015",
    level1: "#9be9a8",
    level2: "#40c463",
    level3: "#30a14e",
    level4: "#216e39",
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
          this.saveSettings();
        },
      }),
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

    const colors = this.settings.colors;
    styleEl.textContent = `
    .level-0 { background-color: ${colors.level0}; }
    .level-1 { background-color: ${colors.level1}; }
    .level-2 { background-color: ${colors.level2}; }
    .level-3 { background-color: ${colors.level3}; }
    .level-4 { background-color: ${colors.level4}; }
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
        console.log(
          `File renamed from ${oldPath} to ${file.path}, updated tracking data`,
        );
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
      const pluginDir = `.obsidian/plugins/${this.manifest.id}`;
      const dataDir = `${pluginDir}/data`;
      const filePath = `${pluginDir}/${this.getDeviceDataPath()}`;

      const pluginDirExists = await this.app.vault.adapter.exists(pluginDir);
      if (!pluginDirExists) {
        await this.app.vault.adapter.mkdir(pluginDir);
      }

      const dataDirExists = await this.app.vault.adapter.exists(dataDir);
      if (!dataDirExists) {
        await this.app.vault.adapter.mkdir(dataDir);
      }

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
      const pluginDir = `.obsidian/plugins/${this.manifest.id}/data`;
      const files = await this.app.vault.adapter.list(pluginDir);
      const deviceFiles = files.files.filter((f) => f.endsWith(".json"));

      const allData: WordCountData[] = [];
      for (const file of deviceFiles) {
        const content = await this.app.vault.adapter.read(file);
        allData.push(JSON.parse(content));
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

    allDevicesData.forEach((deviceData) => {
      Object.entries(deviceData.dailyCounts).forEach(([date, dayData]) => {
        if (!mergedData.dailyCounts[date]) {
          mergedData.dailyCounts[date] = {
            totalDelta: 0,
            files: {},
          };
        }
        mergedData.dailyCounts[date].totalDelta += dayData.totalDelta;
        Object.assign(mergedData.dailyCounts[date].files, dayData.files);
      });
    });

    return mergedData;
  }

  private async loadDeviceData(): Promise<WordCountData | null> {
    try {
      const path = `.obsidian/plugins/${this.manifest.id}/${this.getDeviceDataPath()}`;
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

      console.log(
        `File ${file.path} changed. Delta: ${delta}, Total delta today: ${this.data.dailyCounts[date].totalDelta}`,
      );
    } catch (error) {
      console.error("Error in handleFileModify:", error);
    }
  }
}
