import { TFile } from "obsidian";
import { getCurrentDate } from "@/utils";
import WordCountPlugin from "main";

export async function handleFileRename(
	plugin: WordCountPlugin,
	file: TFile,
	oldPath: string,
) {
	if (!file || file.extension !== "md") {
		return;
	}

	try {
		const date = getCurrentDate();
		const dateData = plugin.getDeviceData(date);

		if (dateData?.files?.[oldPath]) {
			const fileData = dateData.files[oldPath];

			dateData.files[file.path] = fileData;
			delete dateData.files[oldPath];

			await plugin.updateAndSave();
		}
	} catch (error) {
		console.error("Error in handleFileRename:", error);
	}
}
