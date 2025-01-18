import { App, PluginSettingTab, Setting, Modal } from "obsidian";
import { IntensityConfig, ColorConfig, ThemeColors } from "src/types";
import { DEFAULT_SETTINGS } from "../types";

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

		contentEl.createEl("h3", { text: "Confirm action" });
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
			.setName("Low intensity threshold")
			.setDesc("Minimum word count to be considered low intensity")
			.addText((text) =>
				text
					.setPlaceholder("100")
					.setValue(
						this.plugin.settings.intensityLevels.low.toString(),
					)
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
			.setName("Medium intensity threshold")
			.setDesc("Minimum word count to be considered medium intensity")
			.addText((text) =>
				text
					.setPlaceholder("500")
					.setValue(
						this.plugin.settings.intensityLevels.medium.toString(),
					)
					.onChange(async (value) => {
						const newMedium = parseInt(value, 10);
						if (!isNaN(newMedium)) {
							this.plugin.settings.intensityLevels.medium =
								newMedium;
							this.options.onIntensityLevelsChange(
								this.plugin.settings.intensityLevels,
							);
						}
					}),
			);

		new Setting(containerEl)
			.setName("High intensity threshold")
			.setDesc("Minimum word count to be considered high intensity")
			.addText((text) =>
				text
					.setPlaceholder("1000")
					.setValue(
						this.plugin.settings.intensityLevels.high.toString(),
					)
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
			.setName("Show overview")
			.setDesc("Display the overview section in the word count heatmap")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showOverview)
					.onChange(async (value) => {
						this.plugin.settings.showOverview = value;
						this.options.onShowOverviewChange(value);
					}),
			);
		new Setting(containerEl).setName("Heatmap colors").setHeading();

		new Setting(containerEl).setName("Light theme colors").setHeading();
		this.createColorSettings(containerEl, "light");

		new Setting(containerEl).setName("Dark theme colors").setHeading();
		this.createColorSettings(containerEl, "dark");

		new Setting(containerEl)
			.setName("Restore default settings")
			.setDesc("Reset all settings to their original values")
			.addButton((button) =>
				button
					.setButtonText("Restore defaults")
					.setCta()
					.onClick(() => {
						new ConfirmationModal(
							this.plugin.app,
							"Are you sure you want to restore default settings? This will reset all Word Count plugin settings to their original values.",
							async () => {
								// Restore default settings
								this.plugin.settings.intensityLevels = {
									low: DEFAULT_SETTINGS.intensityLevels.low,
									medium: DEFAULT_SETTINGS.intensityLevels
										.medium,
									high: DEFAULT_SETTINGS.intensityLevels.high,
								};

								this.plugin.settings.showOverview =
									DEFAULT_SETTINGS.showOverview;

								this.plugin.settings.colors = {
									...DEFAULT_SETTINGS.colors,
								};

								this.plugin.update();
								this.plugin.applyColorStyles();
								this.display();
							},
						).open();
					}),
			);

		// RESTORE DATA
		new Setting(containerEl)
			.setName("Restore data from previous versions")
			.setDesc("Helps migrate data from versions prior to 0.1.2.")
			.addButton((button) =>
				button
					.setButtonText("Restore data")
					.setCta()
					.onClick(() => {
						this.plugin.restoreDataFromPreviousVersions();
					}),
			);
	}

	private createColorSettings(
		containerEl: HTMLElement,
		theme: "light" | "dark",
	) {
		const colorDescriptions = {
			level_0: "No activity color",
			level_1: "Low activity color",
			level_2: "Medium activity color",
			level_3: "High activity color",
			level_4: "Very high activity color",
		};

		Object.entries(colorDescriptions).forEach(([level, name]) => {
			new Setting(containerEl).setName(name).addColorPicker((color) =>
				color
					.setValue(
						this.plugin.settings.colors[theme][
							level as keyof ColorConfig
						],
					)
					.onChange(async (value) => {
						this.plugin.settings.colors[theme][
							level as keyof ColorConfig
						] = value;
						this.options.onColorsChange(
							this.plugin.settings.colors,
						);
						this.plugin.applyColorStyles();
					}),
			);
		});

		// Add theme-specific reset button
		new Setting(containerEl)
			.setName(
				`Reset ${theme === "light" ? "light" : "dark"} theme colors`,
			)
			.addButton((button) =>
				button.setButtonText("Reset theme colors").onClick(() => {
					new ConfirmationModal(
						this.plugin.app,
						`Are you sure you want to reset the ${theme} theme colors to their default values?`,
						async () => {
							this.plugin.settings.colors[theme] = {
								...DEFAULT_SETTINGS.colors[theme],
							};
							await this.plugin.update();
							this.plugin.applyColorStyles();
							this.display();
						},
					).open();
				}),
			);
	}
}
