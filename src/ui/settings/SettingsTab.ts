import { formatDate } from "@/utils/dateUtils";
import { state } from "@/core/pluginState";
import { App, PluginSettingTab, Setting } from "obsidian";
import { Settings } from "@/defs/types";

import { SETTINGS_SCHEMA, SettingItem } from "./settingSchema";
import {
  createColorSettings,
  createLanguageDropdown,
  createColorModeSettings,
  createThresholdSettings,
  createBackupFolderPathSetting,
} from "./customSettings";

export class SettingsTab extends PluginSettingTab {
  private plugin: any;
  private settings: Settings;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
    this.settings = plugin.data.settings;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Settings are rendered dinamically based on the settings setup file
    SETTINGS_SCHEMA.sections.forEach((section) => {
      new Setting(containerEl).setName(section.title).setHeading();

      section.settings.forEach((setting) => {
        this.renderSetting(containerEl, setting);
        // const currentValue = getByPath(this.settings, setting.key);
        // updateVisibility(setting.key, currentValue);
      });
    });

    // Extra settings and elements not contemplated by settings setup
    // // containerEl.createEl("button").setText("Saw or bug or have feedback?");
    containerEl.createEl("hr");
    containerEl.createEl("div").innerHTML = `
			<a href="https://www.buymeacoffee.com/ezben"><img src="https://img.buymeacoffee.com/button-api/?text=Support this plugin!&emoji=&slug=ezben&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" /></a>
		`;
  }

  private renderSetting(containerEl: HTMLElement, config: any) {
    const wrapper = containerEl.createDiv();
    wrapper.setAttr("data-setting-key", config.key);

    const setting = new Setting(wrapper)
      .setName(config.title)
      .setDesc(config.description ?? "");

    const currentValue = getByPath(this.settings, config.key);

    switch (config.type) {
      case "toggle":
        setting.addToggle((toggle) =>
          toggle.setValue(!!currentValue).onChange(async (value) => {
            setByPath(this.settings, config.key, value);
            await this.plugin.updateAndSaveEverything();
            updateVisibility(config.key, value);
          }),
        );
        break;

      case "date":
        setting.addText((text) => {
          text.inputEl.setAttribute("type", "date");
          text.setValue(formatDate(currentValue)).onChange(async (value) => {
            const date = value ? new Date(value) : null;
            setByPath(this.settings, config.key, date);
            await this.plugin.updateAndSaveEverything();
            updateVisibility(config.key, date);
          });
        });
        setting.addButton((btn) => {
          btn
            .setIcon("trash")
            .setTooltip("Clear date")
            .setDisabled(currentValue !== "")
            .onClick(async () => {
              // Clear the date in settings
              setByPath(this.settings, config.key, undefined);
              await this.plugin.updateAndSaveEverything();

              const inputEl = setting.controlEl.querySelector(
                'input[type="date"]',
              ) as HTMLInputElement;
              if (inputEl) inputEl.value = "";
            });
        });
        break;

      case "number":
        setting.addText((text) =>
          text
            .setPlaceholder(config.placeholder ?? "")
            .setValue(String(currentValue ?? ""))
            .onChange(async (value) => {
              const num = parseInt(value);
              if (!isNaN(num)) {
                setByPath(this.settings, config.key, num);
                await this.plugin.updateAndSaveEverything(); // Maybe add debounce
              }
              updateVisibility(config.key, num);
            }),
        );
        break;

      case "dropdown":
        setting.addDropdown((dropdown) => {
          dropdown
            .addOptions(config.options)
            .setValue(currentValue)
            .onChange(async (value) => {
              setByPath(this.settings, config.key, value);
              await this.plugin.updateAndSaveEverything();
              updateVisibility(config.key, value);
            });
        });
        break;

      case "custom":
        if (config.key == "enabledLanguages") {
          createLanguageDropdown(setting);
          break;
        }
        if (config.key == "heatmapConfig.intensityStops") {
          createThresholdSettings(setting);
          break;
        }
        if (config.key == "heatmapConfig.intensityMode") {
          createColorModeSettings(setting);
          break;
        }
        if (config.key == "heatmapConfig.colors[light]") {
          createColorSettings(setting, "light");
          break;
        }
        if (config.key == "heatmapConfig.colors[dark]") {
          createColorSettings(setting, "dark");
          break;
        }
        if (config.key == "backupConfig.folderPath") {
          createBackupFolderPathSetting(setting, config);
          break;
        }
    }
  }
}

export {};

export function getByPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

// This has to change the whole object cause mutating nested properties won't trigger rerenders for the relevant components
export function setByPath(obj: any, path: string, value: any) {
  const keys = path.split(".");
  const last = keys.pop()!;

  // Walk and copy the object chain to maintain immutability
  let target = obj;
  const parents: any[] = [];
  keys.forEach((key) => {
    parents.push(target);
    target[key] = { ...target[key] }; // create shallow copy
    target = target[key];
  });

  target[last] = value;

  // Re-assign references back up the chain
  for (let i = keys.length - 1; i >= 0; i--) {
    const parent = parents[i];
    parent[keys[i]] = { ...parent[keys[i]] };
  }
}

export function updateVisibility(changedKey: string, newValue: any) {
  SETTINGS_SCHEMA.sections.forEach((section) => {
    section.settings.forEach((s: SettingItem) => {
      if (!s.visibleWhen) return;

      const visibleCondition = s.visibleWhen[changedKey];
      // if (!allowed) return;

      let shouldBeVisible;

      if (typeof visibleCondition == "boolean") {
        shouldBeVisible = visibleCondition == newValue;
      } else {
        // newValue == visibleCondition.includes(newValue);
        shouldBeVisible = true; // TODO: check later for cases, non existent right now
      }

      const el = document.querySelector(
        `[data-setting-key="${s.key}"]`,
      ) as HTMLElement;

      if (!el) return;

      el.style.display = shouldBeVisible ? "block" : "none";
    });
  });
}
