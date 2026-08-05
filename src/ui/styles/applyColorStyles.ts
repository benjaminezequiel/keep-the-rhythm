import { useStore } from "@/core/store";
import { ColorConfig } from "@/defs/types";

/**
 * Reads heatmap color settings from the Zustand store and writes them
 * as CSS custom properties onto the given container element's style.
 */
export function applyHeatmapColorStyles(containerEl: HTMLElement): void {
	const { settings } = useStore.getState();
	const light = settings?.heatmapConfig?.colors?.light;
	const dark = settings?.heatmapConfig?.colors?.dark;

	if (!light || !dark) return;

	for (let i = 0; i <= 4; i++) {
		const key = i as keyof ColorConfig;
		containerEl.style.setProperty(`--light-${i}`, light[key]);
		containerEl.style.setProperty(`--dark-${i}`, dark[key]);
	}
}
