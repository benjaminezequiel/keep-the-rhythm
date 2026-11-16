export interface DailyActivity {
	id?: number;
	date: string;
	filePath: string;
	wordCountStart: number;
	charCountStart: number;
	changes: TimeEntry[];
}

export type FileFilter = (entry: Pick<DailyActivity, "filePath">) => boolean;

export interface TimeEntry {
	timeKey: string;
	w: number;
	c: number;
}
