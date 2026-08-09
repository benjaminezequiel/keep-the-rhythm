import { Notice, App, moment as _moment } from "obsidian";
import { PluginData } from "@/defs/types";
import { formatDate } from "@/utils/dateUtils";

const moment = _moment as unknown as typeof _moment.default;

export interface BackupConfig {
	enabled: boolean;
	folderPath?: string;
	maxNumberOfBackups?: number;
}

export interface BackupModule {
	backupDataToVaultFolder: (data: PluginData, app: any) => Promise<void>;
}

export async function backupData(
	data: PluginData,
	app: App,
): Promise<void> {
    if (!data) return;
    try {
        await backupDataToVaultFolder(data, app);
    } catch (err) {
        console.error("KTR Error trying to create backup: ", err);
    }
}

async function backupDataToVaultFolder(
	data: PluginData,
	app: App,
): Promise<void> {
	const backupConfig = data.settings?.backupConfig;

	if (!backupConfig?.enabled) {
		console.log("KTR: Backups disabled, ignoring");
		return;
	}

	const folderPath = backupConfig.folderPath || ".keep-the-rhythm2";
	const fileName = `backup-${formatDate(new Date())}-${data.schema}.json`;
	const backupPath = `${folderPath}/${fileName}`;
	const jsonData = JSON.stringify(data, null, 2);

	const folderExists = await app.vault.adapter.exists(folderPath);
	if (!folderExists) {
		await app.vault.adapter.mkdir(folderPath);
	}

	if (await app.vault.adapter.exists(backupPath)) {
		const existingContents = await app.vault.adapter.read(backupPath);
		if (existingContents === jsonData) {
			return;
		}
	}
	await app.vault.adapter.write(backupPath, jsonData);
	new Notice("KTR: New backup saved.");

    const maxBackups = backupConfig.maxNumberOfBackups || 3;
	await cleanOlderBackups(folderPath, maxBackups, app);
}

async function cleanOlderBackups(
	folderPath: string,
	maxBackups: number,
	app: App,
): Promise<void> {
	const { files } = await app.vault.adapter.list(folderPath);
	const backupFiles = files.filter((f: string) => f.endsWith(".json"));

	if (backupFiles.length <= maxBackups) return;

	const backupsWithDates = backupFiles
		.map((fullPath: string) => {
			const fileName = fullPath.split("/").pop();
			if (!fileName) return null;

			const match = fileName.match(/^backup-(\d{4}-\d{2}-\d{2})(?:-[\w\d.]+)?\.json$/);
			if (!match) return null;

			const fileDate = moment(match[1], "YYYY-MM-DD", true);
			if (!fileDate.isValid()) return null;

			return { fullPath, fileDate };
		})
		.filter((item): item is { fullPath: string; fileDate: moment.Moment } => item !== null)
		.sort((a, b) => b.fileDate.valueOf() - a.fileDate.valueOf());

	for (let i = maxBackups; i < backupsWithDates.length; i++) {
		await app.vault.adapter.remove(backupsWithDates[i].fullPath);
	}
}