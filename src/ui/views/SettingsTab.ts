import { App, PluginSettingTab, Setting, Modal } from "obsidian";
import {
	IntensityConfig,
	ThemeColors,
	DEFAULT_SETTINGS,
	Language,
	HeatmapColorModes,
	NegativeWordCountMode,
} from "@/defs/types";
import { state } from "@/core/pluginState";

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
		this.onCancel = onCancel || (() => { });
		this.confirmText = confirmText;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		//TODO

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
	showHeatmap: boolean;
	showEntries: boolean;
	colors: ThemeColors;
	enabledScripts: Language[];
	onIntensityLevelsChange: (newLevels: IntensityConfig) => void;
	onShowOverviewChange: (newShowOverview: boolean) => void;
	onShowEntriesChange: (newShowEntries: boolean) => void;
	onShowHeatmapChange: (newShowHeatmap: boolean) => void;
	onColorsChange: (newColors: ThemeColors) => void;
}

export class SettingsTab extends PluginSettingTab {
	private plugin: any;
	private options: SettingsTabOptions;

	constructor(app: App, plugin: any) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async changeColorMode(value: string) {
		const mode = value.toLowerCase();
		const currentStops =
			this.plugin.data.settings.heatmapConfig.intensityStops || {};

		// Initialize missing threshold values based on the selected mode
		const defaultStops = {
			low: currentStops.low ?? 100,
			medium: currentStops.medium ?? 500,
			high: currentStops.high ?? 1000,
		};

		// Only keep the thresholds needed for the selected mode
		let intensityStops;
		switch (mode) {
			case HeatmapColorModes.SOLID:
				intensityStops = {
					low: defaultStops.low,
					medium: defaultStops.medium, // Keep all for consistency
					high: defaultStops.high,
				};
				break;
			case HeatmapColorModes.STOPS:
				intensityStops = {
					low: defaultStops.low,
					medium: defaultStops.medium,
					high: defaultStops.high,
				};
				break;
			case HeatmapColorModes.GRADUAL:
			case HeatmapColorModes.LIQUID:
			default:
				intensityStops = {
					low: defaultStops.low,
					medium: defaultStops.medium, // Keep all for consistency
					high: defaultStops.high,
				};
				break;
		}

		const newConfig = {
			intensityMode: mode,
			intensityStops: intensityStops,
		};

		this.plugin.data.settings.heatmapConfig = {
			...this.plugin.data.settings.heatmapConfig,
			...newConfig,
		};

		await this.plugin.updateAndSaveEverything();
		this.display();
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// containerEl.createEl("h3", { text: "Tutorial / guide" });

		new Setting(containerEl).setName("General").setHeading();

		const enabledLanguages =
			this.plugin.data.settings.enabledLanguages || [];
		let loadedLanguage: string;

		if (enabledLanguages) {
			if (enabledLanguages.length === 1) {
				loadedLanguage = "basic";
			} else if (enabledLanguages.length === 4) {
				loadedLanguage = "cjk";
			} else if (enabledLanguages.length > 4) {
				loadedLanguage = "full";
			} else {
				loadedLanguage = "basic";
			}
		} else {
			loadedLanguage = "basic";
		}

		new Setting(containerEl)
			.setName("Enabled Languages")
			.setDesc("Select which writing systems to count.")
			.setClass("ktr-first")
			.addDropdown((dropdown) => {
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
								newScripts = [
									"LATIN",
									"CJK",
									"JAPANESE",
									"KOREAN",
								];
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
								/**Add checkboxes for individual scripts*/
								break;
						}
						state.plugin.data.settings.enabledLanguages = [
							...newScripts,
						];

						this.plugin.updateAndSaveEverything();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Writing Goal")
			.setDesc("Amount of words you intend to write on a day.")

			.addText((text) =>
				text
					.setPlaceholder("500")
					.setValue(this.plugin.data.settings.dailyWritingGoal || 500)
					.onChange(async (value) => {
						this.plugin.data.settings.dailyWritingGoal = value;
						this.plugin.updateAndSaveEverything();
					}),

			);

		new Setting(containerEl)
			.setName("Negative Word Count Mode")
			.setDesc("Choose how deletions affect your daily stats.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption(NegativeWordCountMode.NET, "Net (Additions - Deletions)")
					.addOption(NegativeWordCountMode.GROSS, "Gross (Additions Only)")
					.setValue(
						this.plugin.data.settings.negativeWordCountMode ||
						NegativeWordCountMode.NET,
					)
					.onChange(async (value) => {
						this.plugin.data.settings.negativeWordCountMode =
							value as NegativeWordCountMode;
						this.plugin.updateAndSaveEverything();
					});
			});

		new Setting(containerEl)
			.setName("Heatmap navigation")
			.setDesc(
				"Clicks open the daily note from that day, using Obsidian's Daily Note core plugin.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.data.settings.heatmapNavigation)
					.onChange(async (value) => {
						this.plugin.data.settings.heatmapNavigation = value;
						this.plugin.updateAndSaveEverything();
					}),
			);

		containerEl.createEl("hr");
		new Setting(containerEl).setName("Sidebar").setHeading();

		new Setting(containerEl)
			.setName("Show overview")
			.setDesc("Display the overview section in the word count heatmap.")
			.setClass("ktr-first")
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.data.settings.sidebarConfig.visibility
							.showSlots,
					)
					.onChange(async (value) => {
						this.plugin.data.settings.sidebarConfig.visibility.showSlots =
							value;
						this.plugin.updateAndSaveEverything();
					}),
			);

		new Setting(containerEl)
			.setName("Show today's entries.")
			.setDesc(
				"Display which files were edited today and their respective word counts.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.data.settings.sidebarConfig.visibility
							.showEntries,
					)
					.onChange(async (value) => {
						this.plugin.data.settings.sidebarConfig.visibility.showEntries =
							value;
						this.plugin.updateAndSaveEverything();
					}),
			);

		new Setting(containerEl)
			.setName("Show heatmap")
			.setDesc("Displays a heatmap with historic writing data.")
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.data.settings.sidebarConfig.visibility
							.showHeatmap,
					)
					.onChange(async (value) => {
						this.plugin.data.settings.sidebarConfig.visibility.showHeatmap =
							value;
						this.plugin.updateAndSaveEverything();
						this.display();
					}),
			);

		if (this.plugin.data.settings.sidebarConfig.visibility.showHeatmap) {
			new Setting(containerEl)
				.setName("Rounded Cells")
				.setClass("KTR-sub-config")
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.data.settings.heatmapConfig.roundCells,
						)
						.onChange(async (value) => {
							const newConfig = {
								roundCells: value,
							};

							this.plugin.data.settings.heatmapConfig = {
								...this.plugin.data.settings.heatmapConfig,
								...newConfig,
							};
							await this.plugin.updateAndSaveEverything();
							this.display();
						}),
				);

			new Setting(containerEl)
				.setName("Hide Month Labels")
				.setClass("KTR-sub-config")
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.data.settings.heatmapConfig
								.hideMonthLabels,
						)
						.onChange(async (value) => {
							const newConfig = {
								hideMonthLabels: value,
							};

							this.plugin.data.settings.heatmapConfig = {
								...this.plugin.data.settings.heatmapConfig,
								...newConfig,
							};

							await this.plugin.updateAndSaveEverything();
							this.display();
						}),
				);

			new Setting(containerEl)
				.setName("Hide Weekday Labels")
				.setClass("KTR-sub-config")
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.data.settings.heatmapConfig
								.hideWeekdayLabels,
						)
						.onChange(async (value) => {
							const newConfig = {
								hideWeekdayLabels: value,
							};

							this.plugin.data.settings.heatmapConfig = {
								...this.plugin.data.settings.heatmapConfig,
								...newConfig,
							};

							await this.plugin.updateAndSaveEverything();
							this.display();
						}),
				);
		}

		containerEl.createEl("hr");

		new Setting(containerEl).setName("Heatmaps").setHeading();

		new Setting(containerEl)
			.setName("Coloring Mode")
			.setClass("ktr-first")
			.setDesc("Choose the coloring method.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({ ...HeatmapColorModes })
					.setValue(
						this.plugin.data.settings.heatmapConfig.intensityMode.toUpperCase(),
					)
					.onChange(async (value) => {
						await this.changeColorMode(value);
					});
			});

		// TODO: add option to choose low/medium/high as the "Goal" and add custom views for that
		this.createThresholdSettings(containerEl);

		this.createColorSettings(containerEl, "light");

		this.createColorSettings(containerEl, "dark");

		containerEl.createEl("hr");

		// new Setting(containerEl).setName("Others").setHeading();

		// containerEl.createEl("hr");
		// containerEl.createEl("button").setText("Saw or bug or have feedback?");

		containerEl.createEl("div").innerHTML = `
			<a href="https://www.buymeacoffee.com/ezben"><img src="https://img.buymeacoffee.com/button-api/?text=Support this plugin!&emoji=&slug=ezben&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" /></a>
		`;
	}
	private createColorSettings(
		containerEl: HTMLElement,
		theme: "light" | "dark",
	) {
		const mode = this.plugin.data.settings.heatmapConfig.intensityMode;
		const colorValues =
			this.plugin.data.settings.heatmapConfig.colors[theme];

		// Define which color levels to show based on mode
		let levelsToShow: number[] = [];

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

		//TODO: ACTUALLY I SHOULD ALWAYS DISPLAY JUST TWO COLORS AND MAKE A GRADIENT OUT OF THE REST IF NECESSARY, no need for the user to choose each color i think

		const setting = new Setting(containerEl)
			.setName(`${theme.charAt(0).toUpperCase() + theme.slice(1)} colors`)
			.setDesc(
				"Colors used to paint each cell, ranges vary based on coloring mode.",
			);

		levelsToShow.forEach((level) => {
			setting.addColorPicker((color) =>
				color.setValue(colorValues[level]).onChange(async (value) => {
					colorValues[level] = value;
					this.plugin.updateAndSaveEverything();
					this.plugin.applyColorStyles();
					this.display();
				}),
			);
		});

		setting.addButton((button) => {
			button.setButtonText("Reset").onClick(() => {
				new ConfirmationModal(
					this.plugin.app,
					`Are you sure you want to reset the ${theme} theme colors to their default values?`,
					async () => {
						this.plugin.data.settings.heatmapConfig.colors[theme] =
						{
							...DEFAULT_SETTINGS.heatmapConfig.colors![
							theme
							],
						};
						await this.plugin.updateAndSaveEverything();
						this.plugin.applyColorStyles();
						this.display();
					},
				).open();
			});
		});
	}

	private createThresholdSettings(containerEl: HTMLElement) {
		const { intensityMode, intensityStops } =
			this.plugin.data.settings.heatmapConfig;
		const setting = new Setting(containerEl)
			.setName("Intensity thresholds")
			.setDesc("Changes how the color of each cell is calculated.");

		// Each mode determines which threshold levels to show
		const thresholds: {
			key: keyof typeof intensityStops;
			placeholder: string;
			label: string;
		}[] = [];

		if (intensityMode !== HeatmapColorModes.SOLID) {
			thresholds.push({
				key: "low",
				placeholder: "100",
				label: "Low",
			});
		}

		if (intensityMode === HeatmapColorModes.STOPS) {
			thresholds.push({
				key: "medium",
				placeholder: "500",
				label: "Medium",
			});
		}

		// Always show high
		thresholds.push({
			key: "high",
			placeholder: "1000",
			label: "High",
		});

		thresholds.forEach(({ key, placeholder, label }) => {
			setting
				.addText((text) =>
					text
						.setValue(intensityStops[key].toString())
						.setPlaceholder(placeholder)
						.onChange(async (value) => {
							const num = parseInt(value);
							if (!isNaN(num)) {
								const newStops = {
									...intensityStops,
									[key]: num,
								};

								// const { low, medium, high } = newStops;

								// const isValid =
								// 	intensityMode === HeatmapColorModes.STOPS
								// 		? low < medium && medium < high
								// 		: low < high;

								// if (!isValid) {
								// 	// new Notice(
								// 	// 	"Invalid thresholds: low < medium < high must be respected.",
								// 	// );
								// 	return;
								// }

								this.plugin.data.settings.heatmapConfig = {
									...this.plugin.data.settings.heatmapConfig,
									intensityStops: newStops,
								};

								await this.plugin.updateAndSaveEverything();
							}
						}),
				)
				.setClass("ktr__threshold-inputs");
		});
	}
}

export { };
