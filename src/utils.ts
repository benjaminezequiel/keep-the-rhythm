import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getCurrentDate(): string {
	const now = new Date();

	return (
		now.getFullYear() +
		"-" +
		String(now.getMonth() + 1).padStart(2, "0") +
		"-" +
		String(now.getDate()).padStart(2, "0")
	);
}

export function parsePathFilter(query: string): string | null {
	const match = query.match(/PATH\s+includes\s+"([^"]+)"/i);
	return match ? match[1] : null;
}

export function parseToggles(query: string) {
	const toggles = {
		showHeatmap: true,
		showOverview: true,
		showEntries: true,
	};

	const hideHeatmap = query.match(/HIDE\s+HEATMAP/i);
	const hideOverview = query.match(/HIDE\s+OVERVIEW/i);
	const hideEntries = query.match(/HIDE\s+ENTRIES/i);

	if (hideHeatmap) toggles.showHeatmap = false;
	if (hideOverview) toggles.showOverview = false;
	if (hideEntries) toggles.showEntries = false;

	return toggles;
}

export const formatDate = (date: Date): string => {
	return (
		date.getFullYear() +
		"-" +
		String(date.getMonth() + 1).padStart(2, "0") +
		"-" +
		String(date.getDate()).padStart(2, "0")
	);
};
