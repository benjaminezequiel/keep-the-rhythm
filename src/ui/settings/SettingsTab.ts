import { formatDate } from "@/utils/dateUtils";
import {
	App,
	PluginSettingTab,
	Setting,
	SettingDefinition,
	SettingDefinitionGroup,
	SettingDefinitionItem,
} from "obsidian";
import KeepTheRhythm from "@/main";
import { Settings } from "@/defs/types";

import { SETTINGS_SCHEMA, SettingItem, SettingsSection } from "./SettingSchema";
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

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...SETTINGS_SCHEMA.sections.map((section) =>
				this.toGroupDefinition(section),
			),
			this.toSupportGroupDefinition(),
		];
	}

	getControlValue(key: string): unknown {
		return getByPath(this.settings, key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		setByPath(this.settings, key, value);
		await this.plugin.updateAndSaveEverything();
		this.refreshDomState();
	}

	private toGroupDefinition(
		section: SettingsSection,
	): SettingDefinitionGroup {
		return {
			type: "group",
			heading: section.title,
			items: section.settings.map((setting) =>
				this.toItemDefinition(setting),
			),
		};
	}

	private toItemDefinition(config: SettingItem): SettingDefinition {
		const visible = config.visibleWhen
			? () => isConditionMet(this.settings, config.visibleWhen!)
			: undefined;

		switch (config.type) {
			case "toggle":
				return {
					name: config.title,
					desc: config.description,
					visible,
					control: { type: "toggle", key: config.key },
				};

			case "number":
				return {
					name: config.title,
					desc: config.description,
					visible,
					control: {
						type: "number",
						key: config.key,
						placeholder: config.placeholder,
					},
				};

			case "dropdown":
				return {
					name: config.title,
					desc: config.description,
					visible,
					control: {
						type: "dropdown",
						key: config.key,
						options: config.options ?? {},
					},
				};

			case "date":
				return {
					name: config.title,
					desc: config.description,
					visible,
					render: (setting) =>
						this.renderDateControl(setting, config),
				};

			case "custom":
				return {
					name: config.title,
					desc: config.description,
					visible,
					render: (setting) =>
						this.renderCustomControl(setting, config),
				};
		}
	}

	private renderDateControl(setting: Setting, config: SettingItem) {
		const currentValue = getByPath(this.settings, config.key);

		setting.addText((text) => {
			text.inputEl.setAttribute("type", "date");
			const dateValue =
				currentValue instanceof Date ? currentValue : new Date();
			text.setValue(formatDate(dateValue)).onChange(async (value) => {
				const date = value ? new Date(value) : null;
				setByPath(this.settings, config.key, date);
				await this.plugin.updateAndSaveEverything();
			});
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
	}

	private toSupportGroupDefinition(): SettingDefinitionGroup {
		return {
			type: "group",
			heading: "Support",
			items: [
				{
					name: "Enjoying Keep the Rhythm?",
					desc: "Consider supporting its development.",
					searchable: false,
					render: (setting) => {
						setting.settingEl.createDiv().innerHTML = `
							<a href="https://www.buymeacoffee.com/ezben"><img src="https://img.buymeacoffee.com/button-api/?text=Support this plugin!&emoji=&slug=ezben&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" /></a>
						`;
					},
				},
			],
		};
	}

	private renderCustomControl(setting: Setting, config: SettingItem) {
		switch (config.key) {
			case "enabledLanguages":
				createLanguageDropdown(setting);
				return;
			case "heatmapConfig.intensityStops":
				createThresholdSettings(setting);
				return;
			case "heatmapConfig.intensityMode":
				createColorModeSettings(setting, () => this.update());
				return;
			case "heatmapConfig.colors[light]":
				createColorSettings(setting, "light");
				return;
			case "heatmapConfig.colors[dark]":
				createColorSettings(setting, "dark");
				return;
			case "backupConfig.folderPath":
				createBackupFolderPathSetting(setting, config);
				return;
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
	let target: Record<string, unknown> = obj as unknown as Record<
		string,
		unknown
	>;
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

function isConditionMet(
	settings: Settings,
	visibleWhen: Record<string, boolean | string[]>,
): boolean {
	return Object.entries(visibleWhen).every(([key, condition]) => {
		const value = getByPath(settings, key);
		if (typeof condition === "boolean") return value === condition;
		if (Array.isArray(condition))
			return condition.includes(value as string);
		return true;
	});
}
