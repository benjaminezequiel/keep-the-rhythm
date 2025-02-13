import { TFile } from "obsidian";
import { getCurrentDate } from "@/utils";
import { handleFileOpen } from "./fileOpen";
import { getExternalWordCount } from "@/wordCounting";
import WordCountPlugin from "main";

export async function handleFileModify(plugin: WordCountPlugin, file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}

	try {
		const date = getCurrentDate();
		const dateData = plugin.getDeviceData(date);

		if (
			!plugin.pluginData.devices[plugin.deviceId][date]?.files?.[
				file.path
			]
		) {
			await handleFileOpen(plugin, file);
			return;
		}

		const content = await plugin.app.vault.read(file);
		const currentWordCount = getExternalWordCount(plugin, content);
		const previousCount = dateData.files[file.path].current;
		const delta = currentWordCount - previousCount;

		dateData.files[file.path].current = currentWordCount;
		dateData.totalDelta += delta;
		await plugin.updateAndSave();
	} catch (error) {
		console.error("Error in handleFileModify:", error);
	}
}
