import { formatDateByMoment } from "@/utils/dateUtils";
import { App, PluginSettingTab, Setting } from "obsidian";
import { Settings } from "@/defs/types";
import { useStore } from "@/core/store";

import { SETTINGS_SCHEMA, SettingItem } from "./SettingSchema";
import {
  createColorSettings,
  createLanguageDropdown,
  createColorModeSettings,
  createThresholdSettings,
  createBackupFolderPathSetting,
} from "./CustomSettings";
import { createTrackedFoldersSetting } from "./TrackedFoldersSetting";

export class SettingsTab extends PluginSettingTab {

  constructor(app: App, plugin: any) {
    super(app, plugin);
  }

  /** Always returns the current store settings reference. */
  private get settings(): Settings {
    return useStore.getState().settings;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Settings are rendered dinamically based on the settings setup file
    SETTINGS_SCHEMA.sections.forEach((section) => {
      new Setting(containerEl).setName(section.title).setHeading();

      section.settings.forEach((setting) => {
        this.renderSetting(containerEl, setting);
      });
    });
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
          toggle.setValue(!!currentValue).onChange((value) => {
            useStore.getState().mutateSettings((draft) => {
              setByPath(draft, config.key, value);
            });
            updateVisibility(config.key, value);
          }),
        );
        break;

      case "date":
        setting.addText((text) => {
          text.inputEl.setAttribute("type", "date");
          text.setValue(formatDateByMoment(currentValue)).onChange((value) => {
            const date = value ? new Date(value) : null;
            useStore.getState().mutateSettings((draft) => {
              setByPath(draft, config.key, date);
            });
            updateVisibility(config.key, date);
          });
        });
        setting.addButton((btn) => {
          btn
            .setIcon("trash")
            .setTooltip("Clear date")
            .setDisabled(currentValue !== "")
            .onClick(() => {
              useStore.getState().mutateSettings((draft) => {
                setByPath(draft, config.key, undefined);
              });

              const inputEl = setting.controlEl.querySelector(
                'input[type="date"]',
              ) as HTMLInputElement;
              if (inputEl) inputEl.value = "";
            });
        });
        break;

      case "number": {
        setting.addText((text) =>
          text
            .setPlaceholder(config.placeholder ?? "")
            .setValue(String(currentValue ?? ""))
            .onChange((value) => {
              const num = parseInt(value);
              if (!isNaN(num)) {
                useStore.getState().mutateSettings((draft) => {
                  setByPath(draft, config.key, num);
                });
              }
              updateVisibility(config.key, num);
            }),
        );
        break;
      }

      case "dropdown":
        setting.addDropdown((dropdown) => {
          dropdown
            .addOptions(config.options)
            .setValue(currentValue)
            .onChange((value) => {
              useStore.getState().mutateSettings((draft) => {
                setByPath(draft, config.key, value);
              });
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
        if (config.key == "trackedFolders") {
          createTrackedFoldersSetting(setting, config);
          break;
        }
    }
  }
}

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
