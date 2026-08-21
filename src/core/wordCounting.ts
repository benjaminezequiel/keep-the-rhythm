import { state } from "./pluginState";
import type { Language } from "@/defs/types";

const UNICODE_RANGES = {
	// A-Z and a-z only, plus Latin-1 Supplement / Extended letters.
	// The old \u0041-\u007A span also covered [ \ ] ^ _ ` and the old
	// \u00A0-\u024F span covered NBSP and symbols such as ¡ § © « ¬ ± × ÷.
	LATIN: "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F",
	CJK: "\\u4E00-\\u9FFF\\u3400-\\u4DBF",
	JAPANESE: "\\u3041-\\u309F\\u30A0-\\u30FF",
	KOREAN: "\\uAC00-\\uD7AF",
	CYRILLIC: "\\u0400-\\u052F",
	GREEK: "\\u0370-\\u03FF",
	ARABIC: "\\u0600-\\u06FF",
	HEBREW: "\\u0590-\\u05FF",
	INDIC: "\\u0900-\\u097F\\u0980-\\u09FF\\u0A80-\\u0AFF\\u0B80-\\u0BFF",
	SOUTHEAST_ASIAN: "\\u0E00-\\u0E7F\\u0E80-\\u0EFF\\u1780-\\u17FF",
	NUMERIC: "0-9",
} as const;

const CHAR_BASED_SCRIPTS: Language[] = [
	"CJK",
	"JAPANESE",
	"KOREAN",
] as Language[];

/**
 * Characters that join two word fragments into a single word: hyphen,
 * underscore, period, straight apostrophe, curly apostrophe, modifier
 * apostrophe. These keep `don't`, `mother-in-law`, `snake_case`, `e.g.`,
 * `Ph.D.` and `example.com` as one word each.
 */
const WORD_CONNECTORS = "\\-_.\\u0027\\u2019\\u02BC";

/** A bare URL, matched whole so it contributes exactly one word. */
const URL_PATTERN = "(?:https?|ftp|file|obsidian):\\/\\/[^\\s<>)\\]]+";

/** An email address, matched whole so it contributes exactly one word. */
const EMAIL_PATTERN = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";

/** `[label](url)` and `![alt](url)`, reduced to the visible label. */
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]*)\]\([^)\n]*\)/g;

/** Obsidian comments: %% inline %% or a multi-line %% ... %% block. */
const COMMENT_PATTERN = /%%[\s\S]*?%%/g;

/** A full task line, including its content: `- [ ] thing`, `2) [x] thing`, `> - [-] thing`. */
const TASK_LINE_PATTERN =
	/^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[[^\]\n]?\][^\n]*$/gm;

/** Just the `[ ]` / `[x]` marker of a task, leaving the task text intact. */
const CHECKBOX_MARKER_PATTERN =
	/^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+)\[[^\]\n]?\][ \t]*/gm;

export interface WordCountOptions {
	ignoreComments?: boolean;
	ignoreTasks?: boolean;
}

function resolveOptions(overrides?: WordCountOptions): WordCountOptions {
	let settings: WordCountOptions | undefined;

	try {
		settings = state?.plugin?.data?.settings as unknown as WordCountOptions;
	} catch {
		settings = undefined;
	}

	return {
		ignoreComments:
			overrides?.ignoreComments ?? settings?.ignoreComments ?? false,
		ignoreTasks: overrides?.ignoreTasks ?? settings?.ignoreTasks ?? false,
	};
}

/**
 * Removes content that should never be counted.
 * Runs before whitespace is collapsed, because task detection is line-based.
 *
 * Checkbox markers are always stripped, even when tasks are counted, since
 * `[ ]` and `[x]` are syntax rather than words.
 */
export function stripIgnoredContent(
	text: string,
	options: WordCountOptions = {},
): string {
	if (!text) return "";

	let result = text;

	if (options.ignoreComments) {
		result = result.replace(COMMENT_PATTERN, " ");
	}

	if (options.ignoreTasks) {
		result = result.replace(TASK_LINE_PATTERN, "");
	}

	result = result.replace(CHECKBOX_MARKER_PATTERN, "$1");

	// The target of a markdown link is not visible prose, so only the label is
	// counted. A bare URL still counts as one word via URL_PATTERN.
	result = result.replace(MARKDOWN_LINK_PATTERN, "$1");

	return result;
}

export function getWordCount(
	text: string,
	regex: RegExp,
	options?: WordCountOptions,
): number {
	if (!text?.trim()) return 0;

	const cleaned = stripIgnoredContent(text, resolveOptions(options))
		.replace(/\s+/gu, " ")
		.trim();

	if (!cleaned) return 0;

	try {
		return (cleaned.match(regex) || []).length;
	} catch (error) {
		console.error("Error counting words:", error);
		return 0;
	}
}

/**
 * @function getCharCount
 * The char equivalent of getWordCount. Applies the same ignore rules, so
 * comments and tasks drop out of the char total too.
 *
 * Whitespace is not collapsed, matching the previous content.length
 * behaviour. A removed comment leaves the single space it was replaced with,
 * which keeps the count self-consistent even though it sits one char above a
 * true strip.
 */
export function getCharCount(text: string, options?: WordCountOptions): number {
	if (!text) return 0;
	return stripIgnoredContent(text, resolveOptions(options)).length;
}

export function createRegex(langs: Language[]): RegExp {
	// Matched first so a URL or address is consumed whole rather than being
	// split into several words by its punctuation.
	const patterns: string[] = [URL_PATTERN, EMAIL_PATTERN];

	const charBasedScripts = langs.filter((script) =>
		CHAR_BASED_SCRIPTS.includes(script),
	);

	if (charBasedScripts.length > 0) {
		const ranges = charBasedScripts
			.map((script) => UNICODE_RANGES[script])
			.join("");
		patterns.push(`[${ranges}]`);
	}

	const wordBasedScripts = langs.filter(
		(script) => !CHAR_BASED_SCRIPTS.includes(script),
	);

	if (wordBasedScripts.length > 0) {
		const ranges = wordBasedScripts
			.map((script) => UNICODE_RANGES[script])
			.join("");

		patterns.push(
			`[${ranges}\\d]+(?:(?:[${WORD_CONNECTORS}][${ranges}\\d]+)|(?:,\\d+))*`,
		);
	}

	if (patterns.length === 0) {
		return /(?!)/gu;
	}

	return new RegExp(patterns.join("|"), "gu");
}

export function getLanguageBasedWordCount(
	text: string,
	enabledLanguages: Language[],
	options?: WordCountOptions,
) {
	const regex: RegExp = createRegex(enabledLanguages);
	return getWordCount(text, regex, options);
}
