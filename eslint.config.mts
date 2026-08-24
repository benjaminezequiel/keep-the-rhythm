import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig(
	globalIgnores([
		"node_modules",
		"main.js",
		"esbuild.config.js",
		"eslint.config.mts",
		"site/_site/**",
		"scripts/**",
	]),
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				projectService: true,
				tsconfigRootDir: configDirectory,
			},
		},
	},
	...obsidianmd.configs.recommended,
);
