import { App, PluginSettingTab, Setting, Modal } from "obsidian";
import { IntensityConfig, ColorConfig, ThemeColors } from "src/types";
import { DEFAULT_SETTINGS } from "../../main";

class ConfirmationModal extends Modal {
  private onConfirm: () => void;
  private onCancel: () => void;
  private message: string;
  private confirmText: string;

  constructor(
    app: App,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmText = "Confirm",
  ) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel || (() => {});
    this.confirmText = confirmText;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Confirm Action" });
    contentEl.createEl("p", { text: this.message });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.onCancel();
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(this.confirmText)
          .setCta()
          .onClick(() => {
            this.onConfirm();
            this.close();
          }),
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

interface SettingsTabOptions {
  intensityLevels: IntensityConfig;
  showOverview: boolean;
  colors: ThemeColors;
  onIntensityLevelsChange: (newLevels: IntensityConfig) => void;
  onShowOverviewChange: (newShowOverview: boolean) => void;
  onColorsChange: (newColors: ThemeColors) => void;
}

export class SettingsTab extends PluginSettingTab {
  
  private plugin: any;
  private options: SettingsTabOptions;

  constructor(app: App, plugin: any, options: SettingsTabOptions) {
    super(app, plugin);
    this.plugin = plugin;
    this.options = options;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Intensity Levels Section
    new Setting(containerEl)
      .setName("Low Intensity Threshold")
      .setDesc("Minimum word count to be considered low intensity")
      .addText((text) =>
        text
          .setPlaceholder("100")
          .setValue(this.plugin.settings.intensityLevels.low.toString())
          .onChange(async (value) => {
            const newLow = parseInt(value, 10);
            if (!isNaN(newLow)) {
              this.plugin.settings.intensityLevels.low = newLow;
              this.options.onIntensityLevelsChange(
                this.plugin.settings.intensityLevels,
              );
            }
          }),
      );

    new Setting(containerEl)
      .setName("Medium Intensity Threshold")
      .setDesc("Minimum word count to be considered medium intensity")
      .addText((text) =>
        text
          .setPlaceholder("500")
          .setValue(this.plugin.settings.intensityLevels.medium.toString())
          .onChange(async (value) => {
            const newMedium = parseInt(value, 10);
            if (!isNaN(newMedium)) {
              this.plugin.settings.intensityLevels.medium = newMedium;
              this.options.onIntensityLevelsChange(
                this.plugin.settings.intensityLevels,
              );
            }
          }),
      );

    new Setting(containerEl)
      .setName("High Intensity Threshold")
      .setDesc("Minimum word count to be considered high intensity")
      .addText((text) =>
        text
          .setPlaceholder("1000")
          .setValue(this.plugin.settings.intensityLevels.high.toString())
          .onChange(async (value) => {
            const newHigh = parseInt(value, 10);
            if (!isNaN(newHigh)) {
              this.plugin.settings.intensityLevels.high = newHigh;
              this.options.onIntensityLevelsChange(
                this.plugin.settings.intensityLevels,
              );
            }
          }),
      );

    // Show Overview Section
    new Setting(containerEl)
      .setName("Show Overview")
      .setDesc("Display the overview section in the word count heatmap")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showOverview)
          .onChange(async (value) => {
            this.plugin.settings.showOverview = value;
            this.options.onShowOverviewChange(value);
          }),
      );
    new Setting(containerEl).setName("Heatmap Colors").setHeading();

    new Setting(containerEl).setName("Light Theme Colors").setHeading();
    this.createColorSettings(containerEl, 'light');

    new Setting(containerEl).setName("Dark Theme Colors").setHeading();    
    this.createColorSettings(containerEl, 'dark');

    new Setting(containerEl)
      .setName("Restore Default Settings")
      .setDesc("Reset all settings to their original values")
      .addButton((button) =>
        button
          .setButtonText("Restore Defaults")
          .setCta()
          .onClick(() => {
            new ConfirmationModal(
              this.plugin.app,
              "Are you sure you want to restore default settings? This will reset all Word Count plugin settings to their original values.",
              async () => {
                // Restore default settings
                this.plugin.settings.intensityLevels = {
                  low: DEFAULT_SETTINGS.intensityLevels.low,
                  medium: DEFAULT_SETTINGS.intensityLevels.medium,
                  high: DEFAULT_SETTINGS.intensityLevels.high,
                };

                this.plugin.settings.showOverview =
                  DEFAULT_SETTINGS.showOverview;

                this.plugin.settings.colors = {
                  ...DEFAULT_SETTINGS.colors,
                };

                // Save the reset settings
                await this.plugin.saveSettings();

                // Apply color styles
                this.plugin.applyColorStyles();

                // Refresh the settings display
                this.display();

                // Refresh the view if it exists
                this.plugin.view?.refresh();
              },
            ).open();
          }),
      );
  }

  private createColorSettings(containerEl: HTMLElement, theme: 'light' | 'dark') {
    const colorDescriptions = {
      level0: "No Activity Color",
      level1: "Low Activity Color",
      level2: "Medium Activity Color",
      level3: "High Activity Color",
      level4: "Very High Activity Color",
    };

    const descriptions = {
      level0: "Color for days with no writing activity",
      level1: "Color for minimal writing activity",
      level2: "Color for moderate writing activity",
      level3: "Color for significant writing activity",
      level4: "Color for intense writing activity",
    };

    Object.entries(colorDescriptions).forEach(([level, name]) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(descriptions[level as keyof typeof descriptions])
        .addColorPicker((color) =>
          color
            .setValue(this.plugin.settings.colors[theme][level as keyof ColorConfig])
            .onChange(async (value) => {
              this.plugin.settings.colors[theme][level as keyof ColorConfig] = value;
              this.options.onColorsChange(this.plugin.settings.colors);
              this.applyColorStyles();
            }),
        );
    });

    // Add theme-specific reset button
    new Setting(containerEl)
      .setName(`Reset ${theme === 'light' ? 'Light' : 'Dark'} Theme Colors`)
      .addButton((button) =>
        button
          .setButtonText("Reset Theme Colors")
          .onClick(() => {
            new ConfirmationModal(
              this.plugin.app,
              `Are you sure you want to reset the ${theme} theme colors to their default values?`,
              async () => {
                this.plugin.settings.colors[theme] = {
                  ...DEFAULT_SETTINGS.colors[theme]
                };
                await this.plugin.saveSettings();
                this.plugin.applyColorStyles();
                this.display();
                this.plugin.view?.refresh();
              },
            ).open();
          }),
      );
  }

 private applyColorStyles() {
    let styleEl = document.getElementById("word-count-heatmap-colors");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "word-count-heatmap-colors";
      document.head.appendChild(styleEl);
    }

    const { light, dark } = this.plugin.settings.colors;
    styleEl.textContent = `
      .theme-light {
        --level-0-color: ${light.level0};
        --level-1-color: ${light.level1};
        --level-2-color: ${light.level2};
        --level-3-color: ${light.level3};
        --level-4-color: ${light.level4};
      }
      
      .theme-dark {
        --level-0-color: ${dark.level0};
        --level-1-color: ${dark.level1};
        --level-2-color: ${dark.level2};
        --level-3-color: ${dark.level3};
        --level-4-color: ${dark.level4};
      }

      .level-0 { background-color: var(--level-0-color); }
      .level-1 { background-color: var(--level-1-color); }
      .level-2 { background-color: var(--level-2-color); }
      .level-3 { background-color: var(--level-3-color); }
      .level-4 { background-color: var(--level-4-color); }
    `;
  }
}
