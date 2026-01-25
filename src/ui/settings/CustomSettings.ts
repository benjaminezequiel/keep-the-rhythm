import { updateVisibility } from "./SettingsTab";
import { Setting } from "obsidian";
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
export function createLanguageDropdown(setting: Setting) {
  const settings = state.plugin.data.settings;
  const enabledLanguages = settings.enabledLanguages || [];
  let loadedLanguage: string;

  if (enabledLanguages.length === 1) loadedLanguage = "basic";
  else if (enabledLanguages.length === 4) loadedLanguage = "cjk";
  else if (enabledLanguages.length > 4) loadedLanguage = "full";
  else loadedLanguage = "basic";

  setting.setClass("ktr-first").addDropdown((dropdown) => {
    const scriptOptions = {
      basic: "Basic (Latin only)",
      cjk: "CJK Support",
      full: "Full Unicode",
    };

    dropdown
      .addOptions(scriptOptions)
      .setValue(loadedLanguage)
      .onChange((value) => {
        let newScripts: Language[] = [];
        switch (value) {
          case "basic":
            newScripts = ["LATIN"];
            break;
          case "cjk":
            newScripts = ["LATIN", "CJK", "JAPANESE", "KOREAN"];
            break;
          case "full":
            newScripts = [
              "LATIN",
              "CJK",
              "JAPANESE",
              "KOREAN",
              "CYRILLIC",
              "GREEK",
              "ARABIC",
              "HEBREW",
              "INDIC",
              "SOUTHEAST_ASIAN",
            ];
            break;
          case "custom":
            // TODO: implement checkboxes if needed
            break;
        }
        settings.enabledLanguages = [...newScripts];
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
