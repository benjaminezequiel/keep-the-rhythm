import { debounce, Plugin, TFile, TAbstractFile, MarkdownView } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import { WordCountView, VIEW_TYPE } from "./src/views/WordCountView";
import {
	DEFAULT_SETTINGS,
	PluginSettings,
	Stats,
	deviceStats,
	PluginData,
} from "src/types";
import { SettingsTab } from "./src/views/SettingsTab";
import "./styles.css";

export default class WordCountPlugin extends Plugin {
	private debouncedHandleModify: (file: TFile) => void;
	pluginData: PluginData;
	settings: PluginSettings;
	statsPerDevice: deviceStats;
	mergedStats: Stats;

	private view: WordCountView | null = null;

	private getDeviceId(): string {
		let deviceId = localStorage.getItem("ktr-device-id");
		if (!deviceId) {
			deviceId = uuidv4();
			localStorage.setItem("ktr-device-id", deviceId);
		}
		return deviceId;
	}

	private createSettingsTab() {
		this.addSettingTab(
			new SettingsTab(this.app, this, {
				intensityLevels: this.settings.intensityLevels,
				showOverview: this.settings.showOverview,
				colors: this.settings.colors,
				onIntensityLevelsChange: (newLevels) => {
					this.settings.intensityLevels = newLevels;
					this.savePluginData();
				},
				onShowOverviewChange: (newShowOverview) => {
					this.settings.showOverview = newShowOverview;
					this.savePluginData();
				},
				onColorsChange: (newColors) => {
					this.settings.colors = newColors;
					this.applyColorStyles();
					this.savePluginData();
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

	getWordCount(text: string): number {
		return text.split(/\s+/).filter((word) => word.length > 0).length;
	}

	private async intializePluginData() {
		const loadedData = await this.loadData();

		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loadedData?.settings || null,
		);
		if (loadedData.devices) {
			this.statsPerDevice = loadedData.devices;
		} else {
			this.statsPerDevice = {
				[this.getDeviceId()]: {},
			};
		}
		await this.mergeDevicesData();
		this.savePluginData();
	}

	async savePluginData() {
		const loadedData = await this.loadData();
		this.saveData({
			settings: this.settings,
			devices: this.statsPerDevice,
		});
	}

	private applyColorStyles() {
		const container = this.app.workspace.containerEl;
		const { light, dark } = this.settings.colors;
		const style = container.style;

		style.setProperty("--light-level-0", light.level0);
		style.setProperty("--light-level-1", light.level1);
		style.setProperty("--light-level-2", light.level2);
		style.setProperty("--light-level-3", light.level3);
		style.setProperty("--light-level-4", light.level4);

		style.setProperty("--dark-level-0", dark.level0);
		style.setProperty("--dark-level-1", dark.level1);
		style.setProperty("--dark-level-2", dark.level2);
		style.setProperty("--dark-level-3", dark.level3);
		style.setProperty("--dark-level-4", dark.level4);
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
		await this.intializePluginData();
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

			if (
				this.statsPerDevice[this.getDeviceId()][date]?.files?.[oldPath]
			) {
				const fileData =
					this.statsPerDevice[this.getDeviceId()][date].files[
						oldPath
					];

				this.statsPerDevice[this.getDeviceId()][date].files[file.path] =
					fileData;
				delete this.statsPerDevice[this.getDeviceId()][date].files[
					oldPath
				];

				this.savePluginData();
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
			const currentDeviceData = this.statsPerDevice[this.getDeviceId()];

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

				this.mergeDevicesData();
				this.savePluginData();
				this.view?.refresh();
			}
		} catch (error) {
			console.error("Error in handleFileOpen:", error);
		}
	}

	async onunload() {
		const style = this.app.workspace.containerEl.style;

		// Clean up all properties
		style.removeProperty("--light-level-0");
		style.removeProperty("--light-level-1");
		style.removeProperty("--light-level-2");
		style.removeProperty("--light-level-3");
		style.removeProperty("--light-level-4");

		style.removeProperty("--dark-level-0");
		style.removeProperty("--dark-level-1");
		style.removeProperty("--dark-level-2");
		style.removeProperty("--dark-level-3");
		style.removeProperty("--dark-level-4");
	}

	async mergeDevicesData() {
		const loadedData = (await this.loadData()) as PluginData;
		const mergedData: Stats = {};

		Object.entries(loadedData.devices).forEach(([deviceId, deviceData]) => {
			Object.entries(deviceData).forEach(([date, data]) => {
				if (!mergedData[date]) {
					mergedData[date] = {
						totalDelta: 0,
						files: {},
					};
				}

				mergedData[date].totalDelta += data.totalDelta;

				Object.entries(data.files).forEach(([filePath, fileCount]) => {
					if (mergedData[date].files[filePath]) {
						mergedData[date].files[filePath] = {
							initial: Math.min(
								mergedData[date].files[filePath].initial,
								fileCount.initial,
							),
							current: Math.max(
								mergedData[date].files[filePath].current,
								fileCount.current,
							),
						};
					} else {
						mergedData[date].files[filePath] = {
							...fileCount,
						};
					}
				});
			});
		});

		this.mergedStats = mergedData;
		console.log(this.mergedStats["2025-01-14"]);
	}

	private async handleFileDelete(file: TFile) {
		if (!file || file.extension !== "md") {
			return;
		}

		try {
			const date = this.getCurrentDate();
			const deviceId = this.getDeviceId();
			if (this.statsPerDevice[deviceId][date]?.files?.[file.path]) {
				const fileData =
					this.statsPerDevice[deviceId][date].files[file.path];
				const lastWordCount = fileData.current;
				const initialWordCount = fileData.initial;

				const fileDelta = lastWordCount - initialWordCount;
				this.statsPerDevice[deviceId][date].totalDelta -= fileDelta;

				this.statsPerDevice[deviceId][date].files[file.path].current =
					0;

				await this.mergeDevicesData();
				this.savePluginData();
				this.view?.refresh();
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
			const deviceId = this.getDeviceId();

			if (!this.statsPerDevice[deviceId][date]?.files?.[file.path]) {
				await this.handleFileOpen(file);
				return;
			}

			const content = await this.app.vault.read(file);
			const currentWordCount = this.getWordCount(content);

			const previousCount =
				this.statsPerDevice[deviceId][date].files[file.path].current;
			const delta = currentWordCount - previousCount;

			this.statsPerDevice[deviceId][date].files[file.path].current =
				currentWordCount;
			this.statsPerDevice[deviceId][date].totalDelta += delta;

			await this.mergeDevicesData();
			this.savePluginData();
			this.view?.refresh();
		} catch (error) {
			console.error("Error in handleFileModify:", error);
		}
	}
}
