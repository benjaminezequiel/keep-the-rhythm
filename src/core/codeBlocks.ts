import { Entries } from "@/ui/components/Entries";
import { SlotWrapper } from "@/ui/components/SlotWrapper";
import { parseSlotQuery } from "./codeBlockQuery";
import { state } from "./pluginState";
import { MarkdownPostProcessorContext } from "obsidian";
import { parseQueryToJSEP } from "./codeBlockQuery";
import { createRoot } from "react-dom/client";
import React from "react";
import { Heatmap } from "@/ui/components/Heatmap";
import { MarkdownRenderChild } from "obsidian";

///////////// HEATMAP
// Previously returned a new function for each code block, now directly processes the block through a unique function
export function createHeatmapCodeBlock(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  if (!state.plugin.data || !state.plugin.data.settings) {
    return; // add log / error
  }

  const trimmedSource = source.trim();
  const query = parseQueryToJSEP(trimmedSource);

  if (!query?.options) return; // add log / error

  const container = el.createDiv("heatmap-codeblock");
  const root = createRoot(container);

  root.render(
    React.createElement(Heatmap, {
      heatmapConfig: query?.options,
      query: query?.filter,
      isCodeBlock: true,
    }),
  );

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
  return;
}

////////////// SLOTS

export function createSlotsCodeBlock(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  if (!state.plugin.data || !state.plugin.data.settings) {
    return; // add log / error
  }
  const config = parseSlotQuery(source);
  if (config.length === 0) return; // add log / error

  const container = el.createDiv("slots-codeblock");
  const root = createRoot(container);

  root.render(
    React.createElement(SlotWrapper, {
      slots: config,
      isCodeBlock: true,
    }),
  );

  return;
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
      // Treat unrecognised lines as a date (existing behaviour)
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
  if (!state.plugin.data || !state.plugin.data.settings) {
    return;
  }

  const container = el.createDiv("slots-codeblock");
  const root = createRoot(container);

  const { date, filters } = parseSource(source);

  console.log(filters);
  root.render(
    React.createElement(Entries, {
      date,
      filters,
    }),
  );
}
