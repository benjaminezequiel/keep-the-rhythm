import {
	debounce,
	Plugin,
	TFile,
	TAbstractFile,
	MarkdownView,
	Stat,
} from "obsidian";
import { v4 as uuidv4 } from "uuid";

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

	private debouncedHandleModify: (file: TFile) => void;

	pluginData: PluginData;
	mergedStats: Stats;

	deviceId: string;
	private view: WordCountView | null = null;

	get settings() {
		return this.pluginData.settings;
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

			const allDeviceIds = new Set([
				...Object.keys(this.pluginData.devices),
				...Object.keys(externalData.devices),
			]);

			const mergedDevices: deviceStats = {};

			// Helper function to calculate files delta
			const calculateFilesDelta = (files: {
				[filePath: string]: FileWordCount;
			}) => {
				return Object.values(files).reduce(
					(sum, file) => sum + (file.current - file.initial),
					0,
				);
			};

			allDeviceIds.forEach((deviceId) => {
				const localDevice = this.pluginData.devices[deviceId];
				const externalDevice = externalData.devices[deviceId];

				// If device only exists in one source, use that data
				if (!localDevice) {
					mergedDevices[deviceId] = externalDevice;
					return;
				}
				if (!externalDevice) {
					mergedDevices[deviceId] = localDevice;
					return;
				}

				mergedDevices[deviceId] = {};

				// Get all dates from both sources
				const allDates = new Set([
					...Object.keys(localDevice),
					...Object.keys(externalDevice),
				]);

				allDates.forEach((date) => {
					const localDate = localDevice[date];
					const externalDate = externalDevice[date];

					if (
						(localDate?.totalDelta || 0) > 0 ||
						(externalDate?.totalDelta || 0) > 0
					) {
						mergedDevices[deviceId][date] = {
							files: {},
							totalDelta: Math.max(
								localDate?.totalDelta || 0,
								externalDate?.totalDelta || 0,
							),
						};
						return;
					}

					// Merge files
					const mergedFiles: { [filePath: string]: FileWordCount } =
						{};

					// Get all files from both sources
					const allFiles = new Set([
						...Object.keys(localDate.files || {}),
						...Object.keys(externalDate.files || {}),
					]);

					// For each file
					allFiles.forEach((filePath) => {
						const localFile = localDate.files?.[filePath];
						const externalFile = externalDate.files?.[filePath];

						// If file only exists in one source, use that data
						if (!localFile) {
							mergedFiles[filePath] = externalFile;
						} else if (!externalFile) {
							mergedFiles[filePath] = localFile;
						} else {
							// File exists in both - merge counts
							mergedFiles[filePath] = {
								initial: Math.min(
									localFile.initial,
									externalFile.initial,
								),
								current: Math.max(
									localFile.current,
									externalFile.current,
								),
							};
						}
					});

					// Calculate new delta from current files
					const newDelta = calculateFilesDelta(mergedFiles);

					// Consider historical deltas from both sources
					const localHistoricalDelta = localDate.totalDelta || 0;
					const externalHistoricalDelta =
						externalDate.totalDelta || 0;

					// Calculate deltas from current files in both sources
					const localFilesDelta = calculateFilesDelta(
						localDate.files || {},
					);
					const externalFilesDelta = calculateFilesDelta(
						externalDate.files || {},
					);

					// Combine all deltas
					// If we have no files but have historical delta, use the max historical
					// If we have files, add their delta to any existing historical delta
					const totalDelta =
						Object.keys(mergedFiles).length === 0
							? Math.max(
									localHistoricalDelta,
									externalHistoricalDelta,
								)
							: newDelta +
								Math.max(
									localHistoricalDelta - localFilesDelta,
									externalHistoricalDelta -
										externalFilesDelta,
								);

					// Create merged date data
					mergedDevices[deviceId][date] = {
						files: mergedFiles,
						totalDelta: totalDelta,
					};
				});
			});

			this.pluginData = {
				settings: Object.assign(
					{},
					DEFAULT_SETTINGS,
					this.pluginData.settings,
					externalData?.settings ?? {},
				),
				devices: mergedDevices,
			};

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
		if (!this.pluginData.devices[this.deviceId][date]) {
			this.pluginData.devices[this.deviceId][date] = {
				totalDelta: 0,
				files: {},
			};
		}
		return this.pluginData.devices[this.deviceId][date];
	}

	getWordCount(text: string): number {
		return text.split(/\s+/).filter((word) => word.length > 0).length;
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

	private async updateAndSave() {
		await this.mergeDevicesData();
		await this.saveData(this.pluginData);
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			if (leaf.view instanceof WordCountView) {
				leaf.view.refresh();
			}
		});
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
			const initialWordCount = this.getWordCount(content);
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
			const currentWordCount = this.getWordCount(content);
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
