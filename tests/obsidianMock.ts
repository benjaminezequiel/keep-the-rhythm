import { FileWordCount, PluginData } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

interface MockDeviceData {
	totalDelta: number;
	files: {
		[path: string]: FileWordCount;
	};
}

interface MockPlugin {
	deviceId: string;
	pluginData: PluginData;
	getDeviceData: (date: string) => MockDeviceData;
	updateAndSave: () => Promise<void>;
	app: {
		vault: {
			read: (file: any) => Promise<string>;
		};
	};
}

export const mockPlugin: MockPlugin = {
	deviceId: "test-device",
	pluginData: {
		settings: DEFAULT_SETTINGS,
		devices: {
			"test-device": {
				"2024-02-06": {
					totalDelta: 0,
					files: {
						"test.md": {
							initial: 10,
							current: 10,
						},
					},
				},
			},
		},
	},
	getDeviceData: (date: string) => {
		const deviceData = mockPlugin.pluginData.devices[mockPlugin.deviceId];
		if (!deviceData || !deviceData[date]) {
			return {
				totalDelta: 0,
				files: {},
			};
		}
		return deviceData[date];
	},
	updateAndSave: async () => Promise.resolve(),
	app: {
		vault: {
			read: async () => "New content with more words",
		},
	},
};
