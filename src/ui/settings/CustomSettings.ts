import { getByPath, setByPath } from "./SettingsTab";
import { SettingItem } from "./SettingSchema";
import { updateVisibility } from "./SettingsTab";
import { Notice, Setting, TextComponent, Modal, TFolder, AbstractInputSuggest, App } from "obsidian";
import { ColorConfig, HeatmapColorModes, Language } from "@/defs/types";
import { DEFAULT_SETTINGS } from "@/defs/types";
import { ConfirmationModal } from "./ConfirmationModal";
import { getPlugin } from "@/core/pluginRegistry";
import { debounce } from "@/utils/utils";

// ------------------------
// Color pickers for light/dark themes
// ------------------------
export function createColorSettings(setting: Setting, theme: "light" | "dark") {
  const settings = getPlugin().data.settings;
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
      color.setValue(colorValues[level]).onChange((value) => {
        colorValues[level] = value;
        getPlugin().updateVisualSettingsOnly();
        getPlugin().applyColorStyles();
        updateVisibility(`heatmapConfig.colors[${theme}]`, value);
      }),
    );
  });

  setting.addButton((button) => {
    button.setIcon("rotate-ccw");
    button.onClick(() => {
      new ConfirmationModal(
        getPlugin().app,
        `Are you sure you want to reset the ${theme} theme colors to their default values?`,
        () => {
          if (!settings.heatmapConfig.colors) return;
          settings.heatmapConfig.colors[theme] = {
            ...DEFAULT_SETTINGS.heatmapConfig.colors![theme],
          };
          getPlugin().updateVisualSettingsOnly();
          getPlugin().applyColorStyles();
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
  const settings = getPlugin().data.settings;
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
      getPlugin().updateVisualSettingsOnly();
      updateVisibility("enabledLanguages", newScripts);
    });
  });
}

// ------------------------
// Coloring mode dropdown
// ------------------------
export function createColorModeSettings(setting: Setting) {
  const settings = getPlugin().data.settings;

  setting.setClass("ktr-first").addDropdown((dropdown) => {
    dropdown
      .addOptions({ ...HeatmapColorModes })
      .setValue(settings.heatmapConfig.intensityMode.toUpperCase())
      .onChange((value) => {
        changeColorMode(value);
        updateVisibility("heatmapConfig.intensityMode", value);
      });
  });
}

// ------------------------
// Threshold inputs
// ------------------------
export function createThresholdSettings(setting: Setting) {
  const settings = getPlugin().data.settings;
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
    const debouncedSave = debounce(() => {
      getPlugin().updateVisualSettingsOnly();
    }, 400);

    setting
      .addText((text) => {
        text
          .setValue(intensityStops[key].toString())
          .setPlaceholder(placeholder)
          .onChange((value) => {
            const num = parseInt(value);
            if (!isNaN(num)) {
              const currentStops = settings.heatmapConfig.intensityStops;
              const newStops = { ...currentStops, [key]: num };
              settings.heatmapConfig = {
                ...settings.heatmapConfig,
                intensityStops: newStops,
              };
              debouncedSave();
              updateVisibility("heatmapConfig.intensityStops", newStops);
            }
          }),
          text.inputEl.setAttribute("data-threshold-key", key);
      })
      .setClass("ktr__threshold-inputs");
  });
}

export function changeColorMode(value: string) {
  const settings = getPlugin().data.settings;
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

  getPlugin().updateVisualSettingsOnly();
}

export function updateThresholdVisibility() {
  const mode = getPlugin().data.settings.heatmapConfig.intensityMode;

  const lowEl = document.querySelector<HTMLInputElement>(
    '[data-threshold-key="low"]',
  );
  const mediumEl = document.querySelector<HTMLInputElement>(
    '[data-threshold-key="medium"]',
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
  const currentValue = getByPath(getPlugin().data.settings, config.key);

  const debouncedSave = debounce(() => {
    getPlugin().updateVisualSettingsOnly();
  }, 400);

  setting.addText((text) => {
    text
      .setPlaceholder(config.placeholder || "")
      .setValue(currentValue || "")
      .onChange((value) => {
        const cleanPath = value.trim().replace(/^\/+|\/+$/g, "");

        setByPath(
          getPlugin().data.settings,
          "backupConfig.folderPath",
          cleanPath || ".keep-the-rhythm",
        );
        debouncedSave();
      });
  });
}

// ------------------------
// Tracked folders (tracking scope)
// ------------------------

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  app: App;
  inputEl: HTMLInputElement;
  private allFolders: TFolder[] = [];

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.app = app;
    this.inputEl = inputEl;
    this.refreshFolders();
  }

  private refreshFolders() {
    this.allFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
  }

  getSuggestions(query: string): TFolder[] {
    if (!query) return this.allFolders.slice(0, 20);
    const lower = query.toLowerCase();
    return this.allFolders
      .filter((folder) => folder.path.toLowerCase().includes(lower))
      .slice(0, 20);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder) {
    this.inputEl.value = folder.path;
    this.inputEl.trigger("input");
    this.close();
  }
}

export class TrackedFoldersModal extends Modal {
  private onChanged: () => void;

  constructor(app: App, onChanged: () => void) {
    super(app);
    this.onChanged = onChanged;
    this.setTitle("Tracked Folders");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("p", {
      text: "Only files under these folders will be tracked. Leave empty to track the whole vault.",
      cls: "ktr-tracked-folders-desc",
    });

    this.renderFolderList(contentEl);

    contentEl.createEl("div", { cls: "ktr-tracked-folders-divider" });

    const inputRow = contentEl.createDiv({
      cls: "ktr-tracked-folders-input-row",
    });

    let textComponent: TextComponent;

    const textWrapper = inputRow.createDiv({
      cls: "ktr-tracked-folders-text-wrapper",
    });

    textComponent = new TextComponent(textWrapper);
    textComponent.setPlaceholder("Enter folder path...");

    new FolderSuggest(this.app, textComponent.inputEl);

    const addBtn = inputRow.createEl("button", {
      text: "Add",
      cls: "ktr-tracked-folders-add-btn",
    });
    addBtn.type = "button";

    const handleAdd = () => {
      const raw = textComponent.getValue();
      const normalized = raw.trim().replace(/^\/+|\/+$/g, "");
      if (!normalized) return;

      const settings = getPlugin().data.settings;
      const folders = settings.trackedFolders || [];
      if (folders.includes(normalized)) {
        new Notice("This folder is already in the tracking scope.");
        return;
      }

      settings.trackedFolders = [...folders, normalized];
      textComponent.setValue("");
      getPlugin().updateVisualSettingsOnly();
      this.onChanged();
      this.renderFolderList(contentEl);
    };

    addBtn.addEventListener("click", () => handleAdd());

    textComponent.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        handleAdd();
      }
    });
  }

  private renderFolderList(contentEl: HTMLElement) {
    const { contentEl: ce } = this;
    // Remove previous list (everything between desc and divider)
    const divider = ce.querySelector(".ktr-tracked-folders-divider");
    if (divider) {
      let node = divider.previousElementSibling;
      while (node && !node.classList.contains("ktr-tracked-folders-desc")) {
        const prev = node.previousElementSibling;
        node.remove();
        node = prev;
      }
    }

    const settings = getPlugin().data.settings;
    const folders = settings.trackedFolders || [];

    const listContainer = ce.createDiv({
      cls: "ktr-tracked-folders-list-items",
    });

    if (folders.length === 0) {
      listContainer.createEl("div", {
        text: "No folders configured — tracking the whole vault.",
        cls: "ktr-tracked-folders-empty",
      });
      return;
    }

    folders.forEach((folder) => {
      const row = listContainer.createDiv({
        cls: "ktr-tracked-folders-item",
      });

      row.createEl("span", {
        text: folder,
        cls: "ktr-tracked-folders-path",
      });

      const deleteBtn = row.createEl("button", {
        cls: "ktr-tracked-folders-delete-btn",
      });
      deleteBtn.type = "button";

      const deleteIcon = document.createElement("span");
      deleteIcon.textContent = "✕";
      deleteBtn.appendChild(deleteIcon);

      deleteBtn.addEventListener("click", () => {
        const currentFolders = getPlugin().data.settings.trackedFolders || [];
        getPlugin().data.settings.trackedFolders = currentFolders.filter(
          (f) => f !== folder,
        );
        getPlugin().updateVisualSettingsOnly();
        this.onChanged();
        this.renderFolderList(contentEl);
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export function createTrackedFoldersSetting(
  setting: Setting,
  _config: SettingItem,
): void {
  const listContainer = setting.infoEl.createDiv({
    cls: "ktr-tracked-folders-list",
  });

  setting.addButton((btn) => {
    btn.setButtonText("Manage").setTooltip("Manage tracked folders").onClick(() => {
      const modal = new TrackedFoldersModal(getPlugin().app, () => {
        getPlugin().updateVisualSettingsOnly();
        renderList();
      });
      modal.open();
    });
  });

  function renderList() {
    listContainer.empty();
    const folders = getPlugin().data.settings.trackedFolders || [];

    if (folders.length === 0) {
      listContainer.createEl("div", {
        text: "No folders configured — tracking the whole vault.",
        cls: "ktr-tracked-folders-empty",
      });
      return;
    }

    const ul = listContainer.createEl("ul", {
      cls: "ktr-tracked-folders-bullet-list",
    });

    folders.forEach((folder) => {
      ul.createEl("li", { text: `${folder}/` });
    });
  }

  renderList();
}