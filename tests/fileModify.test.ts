import { handleFileModify } from "../src/events/fileModify";

import { mockPlugin } from "./obsidianMock";

describe("File modification", () => {
	test("updates word count and delta correctly", async () => {
		const mockFile = { path: "test.md", extension: "md" };
		const mockFileContent = "New content with more words";

		mockPlugin.app = {
			vault: {
				read: async () => mockFileContent,
			},
		};

		await handleFileModify(mockPlugin as any, mockFile as any);

		const dateData = mockPlugin.getDeviceData("2024-02-06");
		expect(dateData.files["test.md"].current).toBe(5);
		expect(dateData.totalDelta).toBe(-5);
	});
});
