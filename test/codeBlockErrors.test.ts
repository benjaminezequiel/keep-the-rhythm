import { beforeEach, expect, it, jest } from "@jest/globals";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { MarkdownPostProcessorContext } from "obsidian";
import {
	createHeatmapCodeBlock,
	createSlotsCodeBlock,
} from "../src/core/codeBlocks";
import { state } from "../src/core/pluginState";
import { DEFAULT_SETTINGS } from "../src/defs/types";

jest.mock("react-dom/client", () => ({ createRoot: jest.fn() }));
jest.mock("../src/ui/components/Entries", () => ({ Entries: () => null }));
jest.mock("../src/ui/components/Heatmap", () => ({ Heatmap: () => null }));
jest.mock("../src/ui/components/SlotWrapper", () => ({
	SlotWrapper: () => null,
}));
jest.mock("../src/core/pluginState", () => ({
	state: { plugin: { data: {} } },
}));
jest.mock("obsidian", () => ({ MarkdownRenderChild: class {} }), {
	virtual: true,
});

const root: Root = { render: jest.fn(), unmount: jest.fn() };
const createDiv = jest.fn<HTMLElement["createDiv"]>();
const element = { createDiv } as unknown as HTMLElement;
const context = {
	addChild: jest.fn(),
} as unknown as MarkdownPostProcessorContext;

beforeEach(() => {
	jest.clearAllMocks();
	state.plugin.data.settings = structuredClone(DEFAULT_SETTINGS);
	jest.mocked(createRoot).mockReturnValue(root);
	createDiv.mockReturnValue({} as HTMLDivElement);
});

it.each([createHeatmapCodeBlock, createSlotsCodeBlock])(
	"shows invalid filters without mounting an unfiltered view",
	(render) => {
		render('filePath starts_with "unterminated', element, context);
		expect(createDiv).toHaveBeenCalledWith({
			cls: "ktr-query-error",
			text: expect.stringContaining("Invalid filter:"),
		});
		expect(createRoot).not.toHaveBeenCalled();
	},
);

it("tells the user to move statistics out of a heatmap", () => {
	createHeatmapCodeBlock(
		'filePath starts_with "Stories/Feed my Necromancer"\nCURRENT_WEEK, WORDS\nWEEKS 26',
		element,
		context,
	);
	expect(createDiv).toHaveBeenCalledWith({
		cls: "ktr-query-error",
		text: expect.stringContaining(
			"CURRENT_WEEK belongs in a ktr-slots block",
		),
	});
	expect(createRoot).not.toHaveBeenCalled();
});

it.each([
	[createHeatmapCodeBlock, 'filePath starts_with "Stories/"\nWEEKS 26'],
	[
		createSlotsCodeBlock,
		'filePath starts_with "Stories/"\nCURRENT_WEEK, WORDS',
	],
])("still mounts valid filtered blocks", (render, source) => {
	render(source, element, context);
	expect(createRoot).toHaveBeenCalledTimes(1);
	expect(createDiv.mock.calls[0][0]).not.toEqual(
		expect.objectContaining({ cls: "ktr-query-error" }),
	);
});
