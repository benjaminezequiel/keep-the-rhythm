import { getByPath, setByPath } from "./SettingsTab";
import { SettingItem } from "./SettingSchema";
import { updateVisibility } from "./SettingsTab";
import { Setting } from "obsidian";
import { ColorConfig, HeatmapColorModes, Language } from "@/defs/types";
import { DEFAULT_SETTINGS } from "@/defs/types";
import { ConfirmationModal } from "./ConfirmationModal";
import { getPlugin } from "@/core/pluginRegistry";
import { useStore } from "@/core/store";
import { applyHeatmapColorStyles } from "@/ui/styles/applyColorStyles";

// ------------------------
// Color pickers for light/dark themes
// ------------------------
export function createColorSettings(setting: Setting, theme: "light" | "dark") {
  const settings = useStore.getState().settings;
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
        useStore.getState().mutateSettings((draft) => {
          if (draft.heatmapConfig.colors) {
            draft.heatmapConfig.colors[theme] = {
              ...draft.heatmapConfig.colors[theme],
              [level]: value,
            };
          }
        });
        applyHeatmapColorStyles(getPlugin().app.workspace.containerEl);
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
          useStore.getState().mutateSettings((draft) => {
            if (draft.heatmapConfig.colors) {
              draft.heatmapConfig.colors[theme] = {
                ...DEFAULT_SETTINGS.heatmapConfig.colors![theme],
              };
            }
          });
          applyHeatmapColorStyles(getPlugin().app.workspace.containerEl);
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
  chinese: { label: "Chinese",     scripts: ["LATIN", "CJK"] },
  cjk:     { label: "CJK Support",       scripts: ["LATIN", "CJK", "JAPANESE", "KOREAN"] },
  full:    { label: "Full Unicode",      scripts: ALL_LANGUAGES },
};

export function createLanguageDropdown(setting: Setting) {
  const settings = useStore.getState().settings;
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
      useStore.getState().mutateSettings((draft) => {
        draft.enabledLanguages = newScripts;
      });
      updateVisibility("enabledLanguages", newScripts);
    });
  });
}

// ------------------------
// Coloring mode dropdown
// ------------------------
export function createColorModeSettings(setting: Setting) {
  const settings = useStore.getState().settings;

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
  const settings = useStore.getState().settings;
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
          .onChange((value) => {
            const num = parseInt(value);
            if (!isNaN(num)) {
              useStore.getState().mutateSettings((draft) => {
                draft.heatmapConfig.intensityStops = {
                  ...draft.heatmapConfig.intensityStops,
                  [key]: num,
                };
              });
              const newStops = useStore.getState().settings.heatmapConfig.intensityStops;
              updateVisibility("heatmapConfig.intensityStops", newStops);
            }
          }),
          text.inputEl.setAttribute("data-threshold-key", key);
      })
      .setClass("ktr__threshold-inputs");
  });
}

export function changeColorMode(value: string) {
  const mode = value.toLowerCase() as HeatmapColorModes;
  const stops = useStore.getState().settings.heatmapConfig.intensityStops || {};
  const defaultStops = { low: 100, medium: 500, high: 1000 };

  useStore.getState().mutateSettings((draft) => {
    draft.heatmapConfig = {
      ...draft.heatmapConfig,
      intensityMode: mode,
      intensityStops: {
        low: stops.low ?? defaultStops.low,
        medium: stops.medium ?? defaultStops.medium,
        high: stops.high ?? defaultStops.high,
      },
    };
  });

  updateThresholdVisibility();
}

export function updateThresholdVisibility() {
  const mode = useStore.getState().settings.heatmapConfig.intensityMode;

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
  const currentValue = getByPath(useStore.getState().settings, config.key);

  setting.addText((text) => {
    text
      .setPlaceholder(config.placeholder || "")
      .setValue(currentValue || "")
      .onChange((value) => {
        const cleanPath = value.trim().replace(/^\/+|\/+$/g, "");

        useStore.getState().mutateSettings((draft) => {
          setByPath(
            draft,
            "backupConfig.folderPath",
            cleanPath || ".keep-the-rhythm2",
          );
        });
      });
  });
}