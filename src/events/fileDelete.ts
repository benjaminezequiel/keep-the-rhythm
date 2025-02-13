import { TFile } from "obsidian";
import { getCurrentDate } from "@/utils";
import WordCountPlugin from "main";

export async function handleFileDelete(plugin: WordCountPlugin, file: TFile) {
	if (!file || file.extension !== "md") {
		return;
	}

	try {
		const date = getCurrentDate();
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
