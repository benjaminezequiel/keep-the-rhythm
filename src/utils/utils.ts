import { HeatmapColorModes } from "../defs/types";
import { CalculationType, TargetCount } from "../defs/types";
import { App } from "obsidian";
import { TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import { WorkspaceLeaf } from "obsidian";

export function getLeafWithFile(app: App, file: TFile): WorkspaceLeaf | null {
	let result: WorkspaceLeaf | null = null;

	app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
		const view = leaf.view;

		if (view instanceof MarkdownView) {
			const currentFile = view.file;
			if (currentFile && currentFile.path === file.path) {
				result = leaf;
			}
		}
	});

	return result;
}

export const getFileName = (path: string): string => {
	return path.split("/").pop() || path;
};

export const getFileNameWithoutExtension = (path: string): string => {
	const fileName = getFileName(path);
	return fileName.replace(/\.[^/.]+$/, "");
};

export function isValidTargetCount(value: string): value is TargetCount {
	return Object.values(TargetCount).includes(value as TargetCount);
}

export function isValidCalculationType(
	value: string,
): value is CalculationType {
	return Object.values(CalculationType).includes(value as CalculationType);
}

export function isValidColoringMode(value: string): value is HeatmapColorModes {
	return Object.values(HeatmapColorModes).includes(
		value as HeatmapColorModes,
	);
}

export function debounce<T extends (...args: any[]) => void>(
	func: T,
	delay: number,
): T {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return function (this: any, ...args: Parameters<T>) {
		if (timeoutId) clearTimeout(timeoutId);
		timeoutId = setTimeout(() => func.apply(this, args), delay);
	} as T;
}

