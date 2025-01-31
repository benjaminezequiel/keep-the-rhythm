module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/tests/mocks/obsidian.ts",
	},
};
