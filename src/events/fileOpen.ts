import { getCurrentDate } from "@/utils";
import WordCountPlugin from "main";
import { TFile } from "obsidian";
import { getExternalWordCount } from "@/wordCounting";

export async function handleFileOpen(plugin: WordCountPlugin, file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}

	try {
		const date = getCurrentDate();
		const content = await plugin.app.vault.read(file);
		const initialWordCount = getExternalWordCount(plugin, content);
		if (!plugin.pluginData.devices[plugin.deviceId]) {
			plugin.pluginData.devices[plugin.deviceId] = {};
		}
		const currentDeviceData = plugin.pluginData.devices[plugin.deviceId];

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

			await plugin.updateAndSave();
		}
	} catch (error) {
		console.error("Error in handleFileOpen:", error);
	}
}
