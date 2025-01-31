import {
	debounce,
	Plugin,
	TFile,
	TAbstractFile,
	MarkdownView,
	Stat,
	Notice,
} from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { createRegex, getWordCount } from "@/wordCounting";
import { WordCountView, VIEW_TYPE } from "./src/views/WordCountView";
import {
	DEFAULT_SETTINGS,
	Stats,
	PluginData,
	deviceStats,
	FileWordCount,
} from "src/types";
import { SettingsTab } from "./src/views/SettingsTab";
import "./styles.css";

export default class WordCountPlugin extends Plugin {
	private readonly LOCAL_BACKUP_PREFIX = "ktr-backup";
	private readonly MAX_BACKUPS = 5;

	private debouncedHandleModify = debounce(
		async (file: TFile) => {
			await this.handleFileModify(file);
		},
		300,
		true,
	);

	pluginData: PluginData;
	mergedStats: Stats;
	regex: RegExp;

	deviceId: string;
	private view: WordCountView | null = null;

	get settings() {
		return this.pluginData.settings;
	}

	getExternalWordCount(text: string) {
		if (!this.regex) {
			this.regex = createRegex(this.settings.enabledScripts);
		}
		return getWordCount(text, this.regex);
	}

	private applyColorStyles() {
		const container = this.app.workspace.containerEl;
		const { light, dark } = this.pluginData.settings.colors;
		const style = container.style;

		const levels = [
			"level_0",
			"level_1",
			"level_2",
			"level_3",
			"level_4",
		] as const;

		levels.forEach((level) => {
			style.setProperty(`--light-${level}`, light[level]);
			style.setProperty(`--dark-${level}`, dark[level]);
		});
	}

	private setDeviceId() {
		let id = localStorage.getItem("ktr-device-id");
		if (!id) {
			id = uuidv4();
			localStorage.setItem("ktr-device-id", id);
		}
		this.deviceId = id;
	}

	async onExternalSettingsChange() {
		try {
			const externalData = (await this.loadData()) as PluginData | null;

			if (!externalData?.devices) {
				console.warn(
					"External data is null, undefined, or missing devices",
				);
				return;
			}

			// For each external device's data
			Object.entries(externalData.devices).forEach(
				([deviceId, deviceData]) => {
					// If this is not our device
					if (deviceId !== this.deviceId) {
						// Simply update/add the external device's data as is
						this.pluginData.devices[deviceId] = deviceData;
					}
				},
			);

			// Update settings
			this.pluginData.settings = Object.assign(
				{},
				DEFAULT_SETTINGS,
				this.pluginData.settings,
				externalData?.settings ?? {},
			);

			await this.updateAndSave();
		} catch (error) {
			console.error("Error in onExternalSettingsChange:", error);
		}
	}

	private createSettingsTab() {
		const pluginWithSettings = {
			...this,
			settings: this.pluginData.settings,
		};

		this.addSettingTab(
			new SettingsTab(this.app, this, {
				intensityLevels: this.pluginData.settings.intensityLevels,
				showOverview: this.pluginData.settings.showOverview,
				colors: this.pluginData.settings.colors,
				enabledScripts: this.pluginData.settings.enabledScripts,
				onIntensityLevelsChange: (newLevels) => {
					this.pluginData.settings.intensityLevels = newLevels;
					this.updateAndSave();
				},
				onShowOverviewChange: (newShowOverview) => {
					this.pluginData.settings.showOverview = newShowOverview;
					this.updateAndSave();
				},
				onColorsChange: (newColors) => {
					this.pluginData.settings.colors = newColors;
					this.applyColorStyles();
					this.updateAndSave();
				},
				onEnabledScriptsChange: (newEnabledScripts) => {
					this.pluginData.settings.enabledScripts = newEnabledScripts;
					this.regex = createRegex(this.settings.enabledScripts);
					this.updateAndSave();
				},
			}),
		);
	}

	private getCurrentDate(): string {
		const now = new Date();

		return (
			now.getFullYear() +
			"-" +
			String(now.getMonth() + 1).padStart(2, "0") +
			"-" +
			String(now.getDate()).padStart(2, "0")
		);
	}

	private getDeviceData(date: string) {
		if (!this.pluginData.devices[this.deviceId]) {
			this.setDeviceId();
			this.update();
		}
		if (!this.pluginData.devices[this.deviceId][date]) {
			this.pluginData.devices[this.deviceId][date] = {
				totalDelta: 0,
				files: {},
			};
		}
		return this.pluginData.devices[this.deviceId][date];
	}

	private async initializePluginData() {
		const loadedData = await this.loadData();
		this.pluginData = {
			settings: Object.assign(
				{},
				DEFAULT_SETTINGS,
				loadedData?.settings ?? {},
			),
			devices: loadedData?.devices ?? {
				[this.deviceId]: {},
			},
		};
		await this.updateAndSave();
	}

	private async update() {
		await this.saveData(this.pluginData);
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			if (leaf.view instanceof WordCountView) {
				leaf.view.refresh();
			}
		});
	}

	private async restoreDataFromPreviousVersions() {
		const path = ".obsidian";

		const files = await this.app.vault.adapter.list(path);
		const deviceFiles = files.files.filter(
			(f) =>
				f.startsWith(`${path}/keep-the-rhythm-`) ||
				f.startsWith(`${path}/ktr-`),
		);

		if (deviceFiles.length === 0) {
			new Notice(
				"No previous data was found, contact the developer if you need more help!",
			);
		}

		const newDeviceSet: deviceStats = {};

		for (const file of deviceFiles) {
			const restoredData: Stats = {};
			try {
				const content = await this.app.vault.adapter.read(file);
				const parsedData = JSON.parse(content);

				const newDeviceName = "restored" + parsedData.deviceId;

				if (this.pluginData.devices[newDeviceName]) {
					new Notice(
						`Data from "${parsedData.deviceId}" of the files was already restored. If you think this is an error, contact the developer.`,
					);
					continue;
				}

				Object.entries(parsedData.dailyCounts).forEach(
					([date, value]) => {
						restoredData[date] = value as {
							totalDelta: number;
							files: {
								[filePath: string]: FileWordCount;
							};
						};
					},
				);

				newDeviceSet[newDeviceName] = restoredData;
			} catch (fileError) {
				new Notice(
					"Previous data couldn't be restored! Contact the plugin developer (Ezben) for help.",
				);
				console.error(`Error restoring data from ${file}:`, fileError);
			}
		}
		this.pluginData.devices = {
			...this.pluginData.devices,
			...newDeviceSet,
		};

		await this.updateAndSave();
		const recoveredFiles = Object.keys(newDeviceSet).length;
		if (recoveredFiles) {
			new Notice(`Data from ${recoveredFiles} files was recovered!`);
		}
	}

	private async updateAndSave() {
		await this.mergeDevicesData();
		await this.update();
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
		this.setDeviceId();
		await this.initializePluginData();
		this.createSettingsTab();
		this.applyColorStyles();

		this.addCommand({
			id: "open-keep-the-rhythm",
			name: "Open tracking heatmap",
			callback: () => {
				this.activateView();
			},
		});

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
			this.app.vault.on(
				"rename",
				(file: TAbstractFile, oldPath: string) => {
					if (file instanceof TFile) {
						this.handleFileRename(file, oldPath);
					}
				},
			),
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
			const dateData = this.getDeviceData(date);

			if (dateData?.files?.[oldPath]) {
				const fileData = dateData.files[oldPath];

				dateData.files[file.path] = fileData;
				delete dateData.files[oldPath];

				await this.updateAndSave();
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
			const initialWordCount = this.getExternalWordCount(content);
			if (!this.pluginData.devices[this.deviceId]) {
				this.pluginData.devices[this.deviceId] = {};
			}
			const currentDeviceData = this.pluginData.devices[this.deviceId];

			if (!currentDeviceData[date]) {
				currentDeviceData[date] = {
					totalDelta: 0,
					files: {},
				};
			}

			if (!currentDeviceData[date].files[file.path]) {
				currentDeviceData[date].files[file.path] = {
					initial: initialWordCount,
					current: initialWordCount,
				};

				await this.updateAndSave();
			}
		} catch (error) {
			console.error("Error in handleFileOpen:", error);
		}
	}

	private async handleFileDelete(file: TFile) {
		if (!file || file.extension !== "md") {
			return;
		}

		try {
			const date = this.getCurrentDate();
			const deviceId = this.deviceId;
			const dateData = this.getDeviceData(date);

			if (dateData.files?.[file.path]) {
				const fileData = dateData.files[file.path];
				const lastWordCount = fileData.current;
				const initialWordCount = fileData.initial;

				const fileDelta = lastWordCount - initialWordCount;
				dateData.totalDelta -= fileDelta;
				dateData.files[file.path].current = 0;

				await this.updateAndSave();
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
			const dateData = this.getDeviceData(date);

			if (
				!this.pluginData.devices[this.deviceId][date]?.files?.[
					file.path
				]
			) {
				await this.handleFileOpen(file);
				return;
			}

			const content = await this.app.vault.read(file);
			const currentWordCount = this.getExternalWordCount(content);
			const previousCount = dateData.files[file.path].current;
			const delta = currentWordCount - previousCount;

			dateData.files[file.path].current = currentWordCount;
			dateData.totalDelta += delta;
			await this.updateAndSave();
		} catch (error) {
			console.error("Error in handleFileModify:", error);
		}
	}

	async mergeDevicesData() {
		const mergedData: Stats = {};

		Object.entries(this.pluginData.devices).forEach(
			([deviceId, deviceData]) => {
				Object.entries(deviceData).forEach(([date, data]) => {
					if (!mergedData[date]) {
						mergedData[date] = {
							totalDelta: 0,
							files: {},
						};
					}

					mergedData[date].totalDelta += data.totalDelta;

					Object.entries(data.files).forEach(
						([filePath, fileCount]) => {
							if (mergedData[date].files[filePath]) {
								mergedData[date].files[filePath] = {
									initial: Math.min(
										mergedData[date].files[filePath]
											.initial,
										fileCount.initial,
									),
									current: Math.max(
										mergedData[date].files[filePath]
											.current,
										fileCount.current,
									),
								};
							} else {
								mergedData[date].files[filePath] = {
									...fileCount,
								};
							}
						},
					);
				});
			},
		);

		this.mergedStats = mergedData;
	}

	async onunload() {
		const style = this.app.workspace.containerEl.style;
		const levels = [
			"level_0",
			"level_1",
			"level_2",
			"level_3",
			"level_4",
		] as const;

		levels.forEach((level) => {
			style.removeProperty(`--light-${level}`);
			style.removeProperty(`--dark-${level}`);
		});
	}
}
