import Dexie from "dexie";

export interface FileStats {
	id?: number;
	path: string;
	filename: string;
	wordCount: number;
	charCount?: number;
	created?: Date;
	deleted?: Date;
	lastModified: Date;
	timesOpened: number;
}

export interface DailyActivity {
	id?: number;
	date: string;
	device: string;
	filePath: string;
	wordsWritten: number;
	charsWritten: number;
	created: boolean;
}

class KTRDatabase extends Dexie {
	fileStats!: Dexie.Table<FileStats, number>;
	dailyActivity!: Dexie.Table<DailyActivity, number>;

	constructor() {
		super("KTRDatabase");

		this.version(1).stores({
			fileStats: "++id, path, filename, created, lastModified",
			dailyActivity: "++id, date, filePath, [date+filePath]",
		});
	}
}

export const db = new KTRDatabase();
