import esbuild from "esbuild";
import builtins from "builtin-modules";
import { sassPlugin } from "esbuild-sass-plugin";

const banner = `/* THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	banner: {
		js: banner,
	},
	entryPoints: ["src/main.ts", "src/ui/styles/styles.scss"],
	entryNames: "[name]",
	outdir: ".",
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	define: {
		"process.env.NODE_ENV": prod ? '"production"' : '"development"',
	},

	minify: prod,
	minifyWhitespace: prod,
	minifyIdentifiers: prod,
	minifySyntax: prod,
	plugins: [
		sassPlugin({
			type: "css",
			outputStyle: "compressed",
		}),
	],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch(); // Watch for file changes in dev mode
}
