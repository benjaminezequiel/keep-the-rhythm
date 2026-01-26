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

export function createEntriesCodeBlock(
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  if (!state.plugin.data || !state.plugin.data.settings) {
    return; // add log / error
  }

  const container = el.createDiv("slots-codeblock");
  const root = createRoot(container);

  let date;
  if (source.trim() !== "") {
    date = source.trim();
  }
  root.render(
    React.createElement(Entries, {
      date: date,
    }),
  );

  return;
}
