import { Language } from "@/defs/types";

const UNICODE_RANGES = {
	LATIN: "\\u0041-\\u007A\\u00A0-\\u024F",
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

const NON_WS_RE = /\S/;

let cachedRegex: RegExp | null = null;
let cachedLangKey: string | null = null;

export function getWordCount(text: string, regex: RegExp): number {
	if (!text || !NON_WS_RE.test(text)) return 0;

	// Non-global regex would loop forever with exec(); fall back to match().
	if (!regex.global) {
		return (text.match(regex) || []).length;
	}

	let count = 0;
	regex.lastIndex = 0;

	try {
		while (regex.exec(text) !== null) {
			count++;
		}
		return count;
	} catch (error) {
		console.error("Error counting words:", error);
		return 0;
	} finally {
		regex.lastIndex = 0;
	}
}

export function createRegex(langs: Language[]): RegExp {
	const patterns: string[] = [];

	const charBasedScripts = langs.filter((script) =>
		["CJK", "JAPANESE", "KOREAN"].includes(script),
	);

	if (charBasedScripts.length > 0) {
		const ranges = charBasedScripts
			.map((script) => UNICODE_RANGES[script])
			.join("");
		patterns.push(`[${ranges}]`);
	}

	const wordBasedScripts = langs.filter(
		(script) => !["CJK", "JAPANESE", "KOREAN"].includes(script),
	);
	if (wordBasedScripts.length > 0) {
		const ranges = wordBasedScripts
			.map((script) => UNICODE_RANGES[script])
			.join("");

		patterns.push(`\\d+(?:[.,]\\d+)*`);
		patterns.push(`[${ranges}\\d]+(?:[-_][${ranges}\\d]+)*`);
	}

	return new RegExp(patterns.join("|"), "gu");
}

export function getLanguageBasedWordCount(
	text: string,
	enabledLanguages: Language[],
) {
	const key = enabledLanguages.join(",");
	if (cachedLangKey !== key) {
		cachedRegex = createRegex(enabledLanguages);
		cachedLangKey = key;
	}
	return getWordCount(text, cachedRegex!);
}
