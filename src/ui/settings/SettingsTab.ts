import { formatDate } from "@/utils/dateUtils";
import { App, PluginSettingTab, Setting } from "obsidian";
import KeepTheRhythm from "@/main";
import { Settings } from "@/defs/types";

import { SETTINGS_SCHEMA, SettingItem } from "./SettingSchema";
import {
	createColorSettings,
	createLanguageDropdown,
	createColorModeSettings,
	createThresholdSettings,
	createBackupFolderPathSetting,
} from "./CustomSettings";

export class SettingsTab extends PluginSettingTab {
	private plugin: KeepTheRhythm;
	private settings: Settings;

	constructor(app: App, plugin: KeepTheRhythm) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = plugin.data.settings;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Settings are rendered dinamically based on the settings setup file
		SETTINGS_SCHEMA.sections.forEach((section) => {
			new Setting(containerEl).setName(section.title).setHeading();

			section.settings.forEach((setting) => {
				this.renderSetting(containerEl, setting);
				// const currentValue = getByPath(this.settings, setting.key);
				// updateVisibility(setting.key, currentValue);
			});
		});

		// Extra settings and elements not contemplated by settings setup
		// // containerEl.createEl("button").setText("Saw or bug or have feedback?");
		containerEl.createEl("hr");
		containerEl.createDiv().innerHTML = `
			<a href="https://www.buymeacoffee.com/ezben"><img src="https://img.buymeacoffee.com/button-api/?text=Support this plugin!&emoji=&slug=ezben&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" /></a>
		`;
	}

	private renderSetting(containerEl: HTMLElement, config: SettingItem) {
		const wrapper = containerEl.createDiv();
		wrapper.setAttr("data-setting-key", config.key);

		const setting = new Setting(wrapper)
			.setName(config.title)
			.setDesc(config.description ?? "");

		const currentValue = getByPath(this.settings, config.key);

		switch (config.type) {
			case "toggle":
				setting.addToggle((toggle) =>
					toggle.setValue(!!currentValue).onChange(async (value) => {
						setByPath(this.settings, config.key, value);
						await this.plugin.updateAndSaveEverything();
						updateVisibility(config.key, value);
					}),
				);
				break;

			case "date":
				setting.addText((text) => {
					text.inputEl.setAttribute("type", "date");
					const dateValue =
						currentValue instanceof Date ? currentValue : new Date();
					text.setValue(formatDate(dateValue)).onChange(
						async (value) => {
							const date = value ? new Date(value) : null;
							setByPath(this.settings, config.key, date);
							await this.plugin.updateAndSaveEverything();
							updateVisibility(config.key, date);
						},
					);
				});
				setting.addButton((btn) => {
					btn.setIcon("trash")
						.setTooltip("Clear date")
						.setDisabled(currentValue !== "")
						.onClick(async () => {
							// Clear the date in settings
							setByPath(this.settings, config.key, undefined);
							await this.plugin.updateAndSaveEverything();

							const inputEl = setting.controlEl.querySelector(
								'input[type="date"]',
							) as HTMLInputElement;
							if (inputEl) inputEl.value = "";
						});
				});
				break;

			case "number":
				setting.addText((text) =>
					text
						.setPlaceholder(config.placeholder ?? "")
						.setValue(
							typeof currentValue === "number" ? String(currentValue) : "",
						)
						.onChange(async (value) => {
							const num = parseInt(value);
							if (!isNaN(num)) {
								setByPath(this.settings, config.key, num);
								await this.plugin.updateAndSaveEverything(); // Maybe add debounce
							}
							updateVisibility(config.key, num);
						}),
				);
				break;

			case "dropdown":
				setting.addDropdown((dropdown) => {
					dropdown
						.addOptions(config.options ?? {})
						.setValue(
							typeof currentValue === "string" ? currentValue : "",
						)
						.onChange(async (value) => {
							setByPath(this.settings, config.key, value);
							await this.plugin.updateAndSaveEverything();
							updateVisibility(config.key, value);
						});
				});
				break;

			case "custom":
				if (config.key == "enabledLanguages") {
					createLanguageDropdown(setting);
					break;
				}
				if (config.key == "heatmapConfig.intensityStops") {
					createThresholdSettings(setting);
					break;
				}
				if (config.key == "heatmapConfig.intensityMode") {
					createColorModeSettings(setting);
					break;
				}
				if (config.key == "heatmapConfig.colors[light]") {
					createColorSettings(setting, "light");
					break;
				}
				if (config.key == "heatmapConfig.colors[dark]") {
					createColorSettings(setting, "dark");
					break;
				}
				if (config.key == "backupConfig.folderPath") {
					createBackupFolderPathSetting(setting, config);
					break;
				}
		}
	}
}

export function getByPath(obj: Settings, path: string): unknown {
	return path.split(".").reduce<unknown>((acc, key) => {
		if (typeof acc !== "object" || acc === null) return undefined;
		return (acc as Record<string, unknown>)[key];
	}, obj);
}

// This has to change the whole object cause mutating nested properties won't trigger rerenders for the relevant components
export function setByPath(obj: Settings, path: string, value: unknown): void {
	const keys = path.split(".");
	const last = keys.pop();
	if (!last) return;

	// Walk and copy the object chain to maintain immutability
	let target: Record<string, unknown> = obj as unknown as Record<string, unknown>;
	const parents: Record<string, unknown>[] = [];
	for (const key of keys) {
		parents.push(target);
		const child = target[key];
		target[key] =
			typeof child === "object" && child !== null ? { ...child } : {};
		target = target[key] as Record<string, unknown>;
	}

	target[last] = value;

	// Re-assign references back up the chain
	for (let i = keys.length - 1; i >= 0; i--) {
		const parent = parents[i];
		const child = parent[keys[i]];
		if (typeof child === "object" && child !== null) {
			parent[keys[i]] = { ...child };
		}
	}
}

export function updateVisibility(changedKey: string, newValue: unknown): void {
	SETTINGS_SCHEMA.sections.forEach((section) => {
		section.settings.forEach((s: SettingItem) => {
			if (!s.visibleWhen) return;

			const visibleCondition = s.visibleWhen[changedKey];
			// if (!allowed) return;

			let shouldBeVisible;

			if (typeof visibleCondition == "boolean") {
				shouldBeVisible = visibleCondition == newValue;
			} else {
				// newValue == visibleCondition.includes(newValue);
				shouldBeVisible = true; // TODO: check later for cases, non existent right now
			}

			const el = document.querySelector(
				`[data-setting-key="${s.key}"]`,
			) as HTMLElement;

			if (!el) return;

			el.style.display = shouldBeVisible ? "block" : "none";
		});
	});
}
