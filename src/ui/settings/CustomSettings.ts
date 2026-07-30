import { getByPath, setByPath } from "./SettingsTab";
import { SettingItem } from "./SettingSchema";
import { updateVisibility } from "./SettingsTab";
import { Notice, Setting, TextComponent } from "obsidian";
import { ColorConfig, HeatmapColorModes, Language } from "@/defs/types";
import { DEFAULT_SETTINGS } from "@/defs/types";
import { ConfirmationModal } from "./ConfirmationModal";
import { state } from "@/core/pluginState";

// ------------------------
// Color pickers for light/dark themes
// ------------------------
export function createColorSettings(setting: Setting, theme: "light" | "dark") {
  const settings = state.plugin.data.settings;
  if (!settings.heatmapConfig.colors) return;

  const mode = settings.heatmapConfig.intensityMode;
  const colorValues = settings.heatmapConfig.colors[theme] as ColorConfig;

  let levelsToShow: (keyof ColorConfig)[] = [];

  switch (mode) {
    case HeatmapColorModes.GRADUAL:
    case HeatmapColorModes.LIQUID:
      levelsToShow = [0, 4];
      break;
    case HeatmapColorModes.SOLID:
      levelsToShow = [4];
      break;
    default:
      levelsToShow = [0, 1, 2, 3, 4];
  }

  levelsToShow.forEach((level) => {
    setting.addColorPicker((color) =>
      color.setValue(colorValues[level]).onChange(async (value) => {
        colorValues[level] = value;
        await state.plugin.updateAndSaveEverything();
        state.plugin.applyColorStyles();
        // propagate visibility if needed
        updateVisibility(`heatmapConfig.colors[${theme}]`, value);
      }),
    );
  });

  setting.addButton((button) => {
    button.setIcon("rotate-ccw");
    button.onClick(() => {
      new ConfirmationModal(
        state.plugin.app,
        `Are you sure you want to reset the ${theme} theme colors to their default values?`,
        async () => {
          if (!settings.heatmapConfig.colors) return;
          settings.heatmapConfig.colors[theme] = {
            ...DEFAULT_SETTINGS.heatmapConfig.colors![theme],
          };
          await state.plugin.updateAndSaveEverything();
          state.plugin.applyColorStyles();
        },
      ).open();
    });
  });
}

// ------------------------
// Language dropdown
// ------------------------
const ALL_LANGUAGES: Language[] = ["LATIN", "CJK", "JAPANESE", "KOREAN", "CYRILLIC", "GREEK", "ARABIC", "HEBREW", "INDIC", "SOUTHEAST_ASIAN"];

const LANGUAGE_PRESETS: Record<string, { label: string; scripts: Language[] }> = {
  basic:   { label: "Basic (Latin only)", scripts: ["LATIN"] },
  chinese: { label: "Chinese (中文)",     scripts: ["LATIN", "CJK"] },
  cjk:     { label: "CJK Support",       scripts: ["LATIN", "CJK", "JAPANESE", "KOREAN"] },
  full:    { label: "Full Unicode",      scripts: ALL_LANGUAGES },
};

export function createLanguageDropdown(setting: Setting) {
  const settings = state.plugin.data.settings;
  const enabled = settings.enabledLanguages || [];

  const loadedKey =
    Object.keys(LANGUAGE_PRESETS).find((k) => {
      const a = LANGUAGE_PRESETS[k].scripts;
      if (enabled.length !== a.length) return false;
      const sorted = [...enabled].sort();
      return [...a].sort().every((v, i) => v === sorted[i]);
    }) || "custom";

  const options: Record<string, string> = {};
  for (const k of Object.keys(LANGUAGE_PRESETS)) options[k] = LANGUAGE_PRESETS[k].label;

  setting.setClass("ktr-first").addDropdown((dropdown) => {
    dropdown.addOptions(options).setValue(loadedKey).onChange((value) => {
      const preset = LANGUAGE_PRESETS[value];
      if (!preset) return;
      const newScripts = [...preset.scripts];
      settings.enabledLanguages = newScripts;
      state.plugin.updateAndSaveEverything();
      updateVisibility("enabledLanguages", newScripts);
    });
  });
}

// ------------------------
// Coloring mode dropdown
// ------------------------
export function createColorModeSettings(setting: Setting) {
  const settings = state.plugin.data.settings;

  setting.setClass("ktr-first").addDropdown((dropdown) => {
    dropdown
      .addOptions({ ...HeatmapColorModes })
      .setValue(settings.heatmapConfig.intensityMode.toUpperCase())
      .onChange(async (value) => {
        await changeColorMode(value); // use callback instead of this.changeColorMode
        updateVisibility("heatmapConfig.intensityMode", value);
      });
  });
}

// ------------------------
// Threshold inputs
// ------------------------
export function createThresholdSettings(setting: Setting) {
  const settings = state.plugin.data.settings;
  const { intensityMode, intensityStops } = settings.heatmapConfig;

  const thresholds: {
    key: keyof typeof intensityStops;
    placeholder: string;
    label: string;
  }[] = [];

  if (intensityMode !== HeatmapColorModes.SOLID)
    thresholds.push({ key: "low", placeholder: "100", label: "Low" });
  if (intensityMode === HeatmapColorModes.STOPS)
    thresholds.push({ key: "medium", placeholder: "500", label: "Medium" });

  thresholds.push({ key: "high", placeholder: "1000", label: "High" });

  thresholds.forEach(({ key, placeholder }) => {
    setting
      .addText((text) => {
        text
          .setValue(intensityStops[key].toString())
          .setPlaceholder(placeholder)
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num)) {
              const newStops = { ...intensityStops, [key]: num };
              settings.heatmapConfig = {
                ...settings.heatmapConfig,
                intensityStops: newStops,
              };
              await state.plugin.updateAndSaveEverything();
              updateVisibility("heatmapConfig.intensityStops", newStops);
            }
          }),
          text.inputEl.setAttribute("data-threshold-key", key);
      })
      .setClass("ktr__threshold-inputs");
  });
}

export async function changeColorMode(value: string) {
  const settings = state.plugin.data.settings;
  const mode = value.toLowerCase() as HeatmapColorModes;

  // Ensure intensityStops exist
  const stops = settings.heatmapConfig.intensityStops || {};
  const defaultStops = { low: 100, medium: 500, high: 1000 };

  settings.heatmapConfig = {
    ...settings.heatmapConfig,
    intensityMode: mode,
    intensityStops: {
      low: stops.low ?? defaultStops.low,
      medium: stops.medium ?? defaultStops.medium,
      high: stops.high ?? defaultStops.high,
    },
  };

  updateThresholdVisibility();

  await state.plugin.updateAndSaveEverything();
}

export function updateThresholdVisibility() {
  const mode = state.plugin.data.settings.heatmapConfig.intensityMode;

  const lowEl = document.querySelector<HTMLInputElement>(
    '[data-threshold-key="low"]',
  );
  const mediumEl = document.querySelector<HTMLInputElement>(
    '[data-threshold-key="medium"]',
  );
  const highEl = document.querySelector<HTMLInputElement>(
    '[data-threshold-key="high"]',
  );

  if (lowEl)
    lowEl.style.display = mode === HeatmapColorModes.SOLID ? "none" : "";
  if (mediumEl)
    mediumEl.style.display = mode === HeatmapColorModes.STOPS ? "" : "none";
}

export function createBackupFolderPathSetting(
  setting: Setting,
  config: SettingItem,
): void {
  const currentValue = getByPath(state.plugin.data.settings, config.key);

  setting.addText((text) => {
    text
      .setPlaceholder(config.placeholder || "")
      .setValue(currentValue || "")
      .onChange(async (value) => {
        const cleanPath = value.trim().replace(/^\/+|\/+$/g, "");

        setByPath(
          state.plugin.data.settings,
          "backupConfig.folderPath",
          cleanPath || ".keep-the-rhythm",
        );
        await state.plugin.updateAndSaveEverything();
      });
  });
}

// ------------------------
// Tracked folders (tracking scope)
// ------------------------
export function createTrackedFoldersSetting(
  setting: Setting,
  config: SettingItem,
): void {
  const wrapper = setting.settingEl.parentElement;
  if (!wrapper) return;

  let textComponent: TextComponent | null = null;

  setting.addText((text) => {
    textComponent = text;
    text.setPlaceholder(config.placeholder || "folder/path");
    text.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        void addFolder();
      }
    });
  });

  setting.addButton((btn) => {
    btn.setButtonText("Add").setTooltip("Add folder").onClick(() => {
      void addFolder();
    });
  });

  const listContainer = wrapper.createDiv({
    cls: "ktr-tracked-folders-list",
  });

  function invalidateVaultCountCache() {
    if (state.plugin.data.stats) {
      state.plugin.data.stats.wholeVaultWordCount = undefined;
    }
  }

  async function addFolder() {
    if (!textComponent) return;
    const raw = textComponent.getValue();
    const normalized = raw.trim().replace(/^\/+|\/+$/g, "");
    if (!normalized) return;

    const folders = state.plugin.data.settings.trackedFolders || [];
    if (folders.includes(normalized)) {
      new Notice("This folder is already in the tracking scope.");
      return;
    }

    state.plugin.data.settings.trackedFolders = [...folders, normalized];
    invalidateVaultCountCache();
    textComponent.setValue("");
    await state.plugin.updateAndSaveEverything();
    renderList();
  }

  async function removeFolder(index: number) {
    const folders = state.plugin.data.settings.trackedFolders || [];
    state.plugin.data.settings.trackedFolders = folders.filter(
      (_, i) => i !== index,
    );
    invalidateVaultCountCache();
    await state.plugin.updateAndSaveEverything();
    renderList();
  }

  function renderList() {
    listContainer.empty();
    const folders = state.plugin.data.settings.trackedFolders || [];

    if (folders.length === 0) {
      listContainer.createEl("div", {
        text: "No folders configured — tracking the whole vault.",
        cls: "ktr-tracked-folders-empty",
      });
      return;
    }

    folders.forEach((folder, index) => {
      new Setting(listContainer)
        .setName(folder)
        .addButton((deleteBtn) => {
          deleteBtn
            .setIcon("trash")
            .setTooltip("Remove")
            .onClick(() => void removeFolder(index));
        });
    });
  }

  renderList();
}