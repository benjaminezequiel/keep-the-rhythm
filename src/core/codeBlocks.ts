import { Entries } from "@/ui/components/Entries";
import { SlotWrapper } from "@/ui/components/SlotWrapper";
import { parseSlotQuery } from "./codeBlockQuery";
import { useStore } from "./store";
import { MarkdownPostProcessorContext } from "obsidian";
import { parseQueryToJSEP } from "./codeBlockQuery";
import { createRoot } from "react-dom/client";
import React from "react";
import { Heatmap } from "@/ui/components/Heatmap";
import { MarkdownRenderChild } from "obsidian";

/**
 * Generic template for creating React code blocks that properly unmount on cleanup
 */
function renderReactCodeBlock(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	className: string,
	element: React.ReactElement,
): void {
	if (!useStore.getState().settings) {
		return;
	}

	const container = el.createDiv(className);
	const root = createRoot(container);

	root.render(element);

	// Without ctx.addChild the React root leaks: every time the markdown
	// is re-rendered (theme switch, layout change, etc.) a new root is
	// created and the previous one keeps its Zustand subscriptions alive.
	ctx.addChild(
		new (class extends MarkdownRenderChild {
			constructor(containerEl: HTMLElement) {
				super(containerEl);
			}
			onunload() {
				root.unmount();
			}
		})(container),
	);
}

///////////// HEATMAP
// Previously returned a new function for each code block, now directly processes the block through a unique function
export function createHeatmapCodeBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const trimmedSource = source.trim();
	const query = parseQueryToJSEP(trimmedSource);

	if (!query?.options) return; // add log / error

	renderReactCodeBlock(el, ctx, "heatmap-codeblock",
		React.createElement(Heatmap, {
			heatmapConfig: query?.options,
			query: query?.filter,
			isCodeBlock: true,
		})
	);
}

////////////// SLOTS

export function createSlotsCodeBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const config = parseSlotQuery(source);
	if (config.length === 0) return;

	renderReactCodeBlock(el, ctx, "slots-codeblock",
		React.createElement(SlotWrapper, {
			slots: config,
			isCodeBlock: true,
		})
	);
}

///////////////// ENTRIES

export type EntryFilter =
	| { type: "includes"; value: string }
	| { type: "excludes"; value: string }
	| { type: "date"; value: string };

function parseSource(source: string): {
	date?: string;
	filters: EntryFilter[];
} {
	const trimmed = source.trim();
	if (!trimmed) return { filters: [] };

	const filters: EntryFilter[] = [];
	let date: string | undefined;

	const lines = trimmed
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	for (const line of lines) {
		const startsWithMatch = line.match(/^filePath\s+includes\s+"([^"]+)"$/);
		const excludeMatch = line.match(/^filePath\s+excludes\s+"([^"]+)"$/);

		if (startsWithMatch) {
			filters.push({ type: "includes", value: startsWithMatch[1] });
		} else if (excludeMatch) {
			filters.push({ type: "excludes", value: excludeMatch[1] });
		} else {
			date = line;
		}
	}

	return { date, filters };
}

export function createEntriesCodeBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const { date, filters } = parseSource(source);

	renderReactCodeBlock(el, ctx, "slots-codeblock",
		React.createElement(Entries, {
			date,
			filters,
		})
	);
}
