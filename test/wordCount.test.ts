import type { Language } from "@/defs/types";
import {
	createRegex,
	getLanguageBasedWordCount,
	getWordCount,
	stripIgnoredContent,
} from "../src/core/wordCounting";
import { describe, expect, it, jest } from "@jest/globals";

// The module reads plugin settings as a fallback. Every test passes options
// explicitly, so the mock only needs to keep the import resolvable.
jest.mock("../src/core/pluginState", () => ({
	state: { plugin: { data: { settings: {} } } },
}));

const LATIN = ["LATIN"] as unknown as Language[];
const LATIN_NUM = ["LATIN", "NUMERIC"] as unknown as Language[];
const lang = (...names: string[]) => names as unknown as Language[];

/** Counts with Latin + numbers enabled and both ignore settings off. */
const count = (text: string) => getLanguageBasedWordCount(text, LATIN_NUM);

const countClean = (text: string) =>
	getLanguageBasedWordCount(text, LATIN_NUM, {
		ignoreComments: true,
		ignoreTasks: true,
	});

describe("empty and degenerate input", () => {
	it("returns 0 for an empty string", () => {
		expect(count("")).toBe(0);
	});

	it("returns 0 for whitespace only", () => {
		expect(count("   \n\t  \n  ")).toBe(0);
	});

	it("returns 0 for null and undefined", () => {
		expect(count(null as unknown as string)).toBe(0);
		expect(count(undefined as unknown as string)).toBe(0);
	});

	it("returns 0 for punctuation only", () => {
		expect(count("... !!! --- ??? ;:,")).toBe(0);
	});

	it("returns 0 when a document is nothing but a comment", () => {
		expect(countClean("%% just a note to self %%")).toBe(0);
	});

	it("returns 0 when a document is nothing but tasks", () => {
		expect(countClean("- [ ] one\n- [x] two\n- [ ] three")).toBe(0);
	});
});

describe("basic Latin counting", () => {
	it("counts simple words", () => {
		expect(count("Hello world")).toBe(2);
		expect(count("The quick brown fox jumps")).toBe(5);
	});

	it("ignores surrounding punctuation", () => {
		expect(count("Hello, world!")).toBe(2);
		expect(count('"Stop," she said.')).toBe(3);
		expect(count("(parenthesised) [bracketed] {braced}")).toBe(3);
	});

	it("collapses repeated whitespace", () => {
		expect(count("  multiple    spaces   here  ")).toBe(3);
		expect(count("line one\nline two")).toBe(4);
		expect(count("tab\tseparated\twords")).toBe(3);
		expect(count("hello\u00A0world")).toBe(2); // non-breaking space
	});

	it("does not count brackets, backticks or symbols as words", () => {
		expect(count("[ ]")).toBe(0);
		expect(count("[]")).toBe(0);
		expect(count("^ _ ` \\ | ~ @ # $ %")).toBe(0);
		expect(count("a × b ÷ c")).toBe(3);
		expect(count("© 2024 ½ §")).toBe(1); // only the number counts
	});

	it("ignores emoji", () => {
		expect(count("hello 👋 world")).toBe(2);
		expect(count("👋🎉🚀")).toBe(0);
	});
});

describe("contractions and possessives", () => {
	it("counts a straight-apostrophe contraction as one word", () => {
		expect(count("don't")).toBe(1);
		expect(count("I don't know")).toBe(3);
		expect(count("it's can't won't shouldn't")).toBe(4);
	});

	it("counts a typographic apostrophe contraction as one word", () => {
		expect(count("don\u2019t")).toBe(1);
		expect(count("I\u2019ll be there")).toBe(3);
	});

	it("handles the modifier-letter apostrophe", () => {
		expect(count("don\u02BCt")).toBe(1);
	});

	it("counts o'clock and similar as one word", () => {
		expect(count("five o'clock")).toBe(2);
		expect(count("O'Brien and D'Angelo")).toBe(3);
	});

	it("does not let a trailing possessive apostrophe add a word", () => {
		expect(count("the dogs' bowls")).toBe(3);
		expect(count("James' car")).toBe(2);
	});

	it("does not let a leading apostrophe add a word", () => {
		expect(count("'tis the season")).toBe(3);
		expect(count("he said 'hello' twice")).toBe(4);
	});

	it("counts standalone apostrophe fragments as their own word", () => {
		expect(count("rock 'n' roll")).toBe(3);
	});
});

describe("hyphens and underscores", () => {
	it("counts hyphenated words as one", () => {
		expect(count("mother-in-law")).toBe(1);
		expect(count("well-known e-mail state-of-the-art")).toBe(3);
	});

	it("counts snake_case as one word", () => {
		expect(count("snake_case_name")).toBe(1);
		expect(count("_leading trailing_")).toBe(2);
	});

	it("does not join across a dangling hyphen", () => {
		expect(count("trailing-")).toBe(1);
		expect(count("-leading hyphen")).toBe(2);
		expect(count("a - b")).toBe(2);
	});

	it("treats dashes as separators", () => {
		expect(count("word\u2014word")).toBe(2); // em dash
		expect(count("word\u2013word")).toBe(2); // en dash
	});
});

describe("numbers", () => {
	it("counts a bare integer as one word", () => {
		expect(count("42")).toBe(1);
		expect(count("I have 10 apples")).toBe(4);
	});

	it("counts decimals as one word", () => {
		expect(count("3.14")).toBe(1);
		expect(count("pi is 3.14159 roughly")).toBe(4);
	});

	it("counts thousands separators as one word", () => {
		expect(count("1,000")).toBe(1);
		expect(count("1,000.50")).toBe(1);
		expect(count("1.000,50")).toBe(1); // European style
	});

	it("counts multi-part version numbers as one word", () => {
		expect(count("Version 2.0.1")).toBe(2);
	});

	it("counts alphanumeric tokens as one word", () => {
		expect(count("h1")).toBe(1);
		expect(count("covid19")).toBe(1);
		expect(count("123abc")).toBe(1);
		expect(count("A4 paper")).toBe(2);
	});
});

describe("accented and extended Latin", () => {
	it("counts accented words as single words", () => {
		expect(count("café")).toBe(1);
		expect(count("naïve résumé")).toBe(2);
		expect(count("Ärger über Straße")).toBe(3);
		expect(count("Ærø Zoë Œuvre")).toBe(3);
	});

	it("counts Latin Extended-A and -B letters", () => {
		expect(count("Łódź")).toBe(1);
		expect(count("čeština")).toBe(1);
	});
});

describe("markdown syntax", () => {
	it("ignores emphasis markers", () => {
		expect(count("**bold** and *italic*")).toBe(3);
		expect(count("~~struck through~~")).toBe(2);
	});

	it("ignores heading markers", () => {
		expect(count("# Heading here")).toBe(2);
		expect(count("### Third level heading")).toBe(3);
	});

	it("ignores list bullets", () => {
		expect(count("- first item\n- second item")).toBe(4);
		expect(count("* star item")).toBe(2);
		expect(count("1. numbered item")).toBe(3); // the "1" counts as a word
	});

	it("counts wikilink text", () => {
		expect(count("See [[My Note]] for details")).toBe(5);
	});
});

describe("links and addresses", () => {
	it("counts a markdown link by its visible label only", () => {
		expect(count("[link](https://example.com)")).toBe(1);
		expect(count("See [my great article](https://example.com) now")).toBe(
			5,
		);
	});

	it("counts an image embed by its alt text", () => {
		expect(count("![alt text](image.png)")).toBe(2);
	});

	it("counts a bare URL as one word", () => {
		expect(count("Visit https://example.com today")).toBe(3);
		expect(count("https://example.com/a/b?q=1&r=2")).toBe(1);
		expect(count("<https://example.com>")).toBe(1);
		expect(count("obsidian://open?vault=x")).toBe(1);
	});

	it("counts a sentence-final period after a URL separately", () => {
		expect(count("See https://example.com.")).toBe(2);
	});

	it("counts a bare domain as one word", () => {
		expect(count("example.com")).toBe(1);
	});

	it("counts an email address as one word", () => {
		expect(count("mail me at foo@bar.com")).toBe(4);
		expect(count("first.last@sub.domain.co.uk")).toBe(1);
	});

	it("strips link targets in stripIgnoredContent", () => {
		expect(stripIgnoredContent("[label](https://x.com)")).toBe("label");
	});

	it("still removes a task containing a link", () => {
		expect(
			getLanguageBasedWordCount(
				"- [ ] read [docs](https://x.com)",
				LATIN_NUM,
				{
					ignoreTasks: true,
				},
			),
		).toBe(0);
	});
});

describe("abbreviations", () => {
	it("counts a dotted abbreviation as one word", () => {
		expect(count("e.g. this")).toBe(2);
		expect(count("i.e.")).toBe(1);
		expect(count("The U.S.A. is large")).toBe(4);
		expect(count("She has a Ph.D. now")).toBe(5);
		expect(count("Use e.g. or i.e. here")).toBe(5);
	});

	it("still splits on a sentence-ending period", () => {
		expect(count("end. Next")).toBe(2);
	});

	it("does not join across a comma", () => {
		expect(count("apples,oranges")).toBe(2);
	});
});

describe("comment handling", () => {
	const withComments = (text: string) =>
		getLanguageBasedWordCount(text, LATIN_NUM, { ignoreComments: false });
	const withoutComments = (text: string) =>
		getLanguageBasedWordCount(text, LATIN_NUM, { ignoreComments: true });

	it("counts comment contents when the setting is off", () => {
		expect(withComments("Hello %%this is a comment%% world")).toBe(6);
	});

	it("skips an inline comment when the setting is on", () => {
		expect(withoutComments("Hello %%this is a comment%% world")).toBe(2);
	});

	it("skips a multi-line comment block", () => {
		const text = [
			"Before the block",
			"%%",
			"hidden text here",
			"%%",
			"After",
		].join("\n");
		expect(withoutComments(text)).toBe(4);
	});

	it("skips several comments in the same document", () => {
		expect(withoutComments("a %%one%% b %%two%% c")).toBe(3);
	});

	it("handles an empty comment", () => {
		expect(withoutComments("before %%%% after")).toBe(2);
	});

	it("does not merge words across a removed comment", () => {
		expect(withoutComments("word%%hidden%%word")).toBe(2);
	});

	it("leaves an unterminated comment marker in place", () => {
		// Only balanced %% pairs are removed.
		expect(withoutComments("real text %% dangling marker")).toBe(4);
	});

	it("stops at the first closing marker", () => {
		expect(withoutComments("%%a%% visible %%b%%")).toBe(1);
	});

	it("handles a comment at the very start and end", () => {
		expect(withoutComments("%%note%% only these words %%note%%")).toBe(3);
	});
});

describe("task handling", () => {
	const withTasks = (text: string) =>
		getLanguageBasedWordCount(text, LATIN_NUM, { ignoreTasks: false });
	const withoutTasks = (text: string) =>
		getLanguageBasedWordCount(text, LATIN_NUM, { ignoreTasks: true });

	it("counts task text but not the checkbox when the setting is off", () => {
		expect(withTasks("- [ ] Buy milk")).toBe(2);
		expect(withTasks("- [x] Buy milk")).toBe(2);
		expect(withTasks("- [X] Buy milk")).toBe(2);
		expect(withTasks("- [-] Buy milk")).toBe(2);
	});

	it("skips whole task lines when the setting is on", () => {
		expect(withoutTasks("- [ ] Buy milk")).toBe(0);
		expect(withoutTasks("- [x] Finish the report today")).toBe(0);
	});

	it("handles every bullet marker", () => {
		expect(withoutTasks("* [ ] star task")).toBe(0);
		expect(withoutTasks("+ [ ] plus task")).toBe(0);
		expect(withoutTasks("1. [ ] numbered task")).toBe(0);
		expect(withoutTasks("2) [x] paren numbered task")).toBe(0);
	});

	it("handles indented and nested tasks", () => {
		expect(withoutTasks("    - [ ] indented task")).toBe(0);
		expect(withoutTasks("\t- [x] tab indented task")).toBe(0);
	});

	it("handles tasks inside blockquotes", () => {
		expect(withoutTasks("> - [ ] quoted task")).toBe(0);
	});

	it("leaves ordinary list items alone", () => {
		expect(withoutTasks("- Just a list item")).toBe(4);
		expect(withoutTasks("- Not a task [because] no marker")).toBe(6);
	});

	it("does not treat inline brackets as a task", () => {
		expect(withoutTasks("This sentence has [x] in the middle")).toBe(7);
	});

	it("keeps surrounding prose when removing tasks", () => {
		const text = [
			"Intro sentence here",
			"- [ ] Task one",
			"- Normal item",
			"- [x] Task two",
			"Closing line",
		].join("\n");
		expect(withoutTasks(text)).toBe(7);
		expect(withTasks(text)).toBe(11);
	});

	it("counts an empty task line as nothing either way", () => {
		expect(withTasks("- [ ]")).toBe(0);
		expect(withoutTasks("- [ ]")).toBe(0);
	});
});

describe("comments and tasks combined", () => {
	it("removes both from one document", () => {
		const text = [
			"# Project notes",
			"",
			"%% private thoughts that should not count %%",
			"",
			"The body text is here.",
			"",
			"- [ ] first task",
			"- [x] second task %% with a comment %%",
			"",
			"Final paragraph.",
		].join("\n");

		expect(countClean(text)).toBe(9);
	});

	it("removes a task that is entirely inside a comment", () => {
		const text = "%%\n- [ ] hidden task\n%%\nvisible text";
		expect(countClean(text)).toBe(2);
	});
});

describe("stripIgnoredContent", () => {
	it("is a no-op when both settings are off, except for checkbox markers", () => {
		expect(stripIgnoredContent("plain text")).toBe("plain text");
		expect(stripIgnoredContent("- [ ] task")).toBe("- task");
	});

	it("removes comments only when asked", () => {
		expect(stripIgnoredContent("a %%b%% c", { ignoreComments: true })).toBe(
			"a   c",
		);
		expect(stripIgnoredContent("a %%b%% c")).toBe("a %%b%% c");
	});

	it("removes task lines but keeps the line breaks", () => {
		expect(
			stripIgnoredContent("one\n- [ ] task\ntwo", { ignoreTasks: true }),
		).toBe("one\n\ntwo");
	});
});

describe("character-based scripts", () => {
	it("counts Chinese characters individually", () => {
		expect(getLanguageBasedWordCount("你好世界", lang("CJK"))).toBe(4);
		expect(getLanguageBasedWordCount("我喜欢编程", lang("CJK"))).toBe(5);
	});

	it("ignores CJK punctuation", () => {
		expect(getLanguageBasedWordCount("你好，世界。", lang("CJK"))).toBe(4);
	});

	it("counts Japanese kana and kanji individually", () => {
		expect(getLanguageBasedWordCount("こんにちは", lang("JAPANESE"))).toBe(
			5,
		);
		expect(getLanguageBasedWordCount("カタカナ", lang("JAPANESE"))).toBe(4);
		expect(
			getLanguageBasedWordCount("日本語", lang("CJK", "JAPANESE")),
		).toBe(3);
	});

	it("counts Korean syllables individually", () => {
		expect(getLanguageBasedWordCount("안녕하세요", lang("KOREAN"))).toBe(5);
	});

	it("counts nothing for a script that is not enabled", () => {
		expect(getLanguageBasedWordCount("你好世界", LATIN)).toBe(0);
		expect(getLanguageBasedWordCount("こんにちは", lang("CJK"))).toBe(0);
	});
});

describe("word-based non-Latin scripts", () => {
	it("counts Cyrillic words", () => {
		expect(getLanguageBasedWordCount("Привет мир", lang("CYRILLIC"))).toBe(
			2,
		);
	});

	it("counts Greek words", () => {
		expect(getLanguageBasedWordCount("Γειά σου κόσμε", lang("GREEK"))).toBe(
			3,
		);
	});

	it("counts Arabic words", () => {
		expect(getLanguageBasedWordCount("مرحبا بالعالم", lang("ARABIC"))).toBe(
			2,
		);
	});

	it("counts Hebrew words", () => {
		expect(getLanguageBasedWordCount("שלום עולם", lang("HEBREW"))).toBe(2);
	});

	it("counts Devanagari words including matras", () => {
		expect(getLanguageBasedWordCount("नमस्ते दुनिया", lang("INDIC"))).toBe(
			2,
		);
	});

	it("counts an unspaced Thai run as a single word (known limitation)", () => {
		expect(
			getLanguageBasedWordCount("สวัสดีครับ", lang("SOUTHEAST_ASIAN")),
		).toBe(1);
	});
});

describe("mixed scripts", () => {
	it("counts Latin words and CJK characters in one document", () => {
		expect(
			getLanguageBasedWordCount(
				"日本語とEnglish",
				lang("CJK", "JAPANESE", "LATIN"),
			),
		).toBe(5);
	});

	it("counts only enabled scripts in a mixed document", () => {
		expect(getLanguageBasedWordCount("Hello 你好", LATIN)).toBe(1);
		expect(getLanguageBasedWordCount("Hello 你好", lang("CJK"))).toBe(2);
		expect(
			getLanguageBasedWordCount("Hello 你好", lang("LATIN", "CJK")),
		).toBe(3);
	});

	it("handles a realistic multilingual note", () => {
		const text = "Meeting notes: 会議は3時です. Привет!";
		expect(
			getLanguageBasedWordCount(
				text,
				lang("LATIN", "NUMERIC", "CJK", "JAPANESE", "CYRILLIC"),
			),
		).toBe(10);
	});
});

describe("createRegex", () => {
	it("produces a global unicode regex", () => {
		const regex = createRegex(LATIN_NUM);
		expect(regex.flags).toContain("g");
		expect(regex.flags).toContain("u");
	});

	it("produces a never-matching regex for an empty language list", () => {
		// A naive join of zero patterns compiles to //gu, which matches at
		// every position and reports one "word" per character.
		expect(createRegex([]).test("Hello world")).toBe(false);
		expect(getLanguageBasedWordCount("Hello world", [])).toBe(0);
	});
});

describe("getWordCount error handling", () => {
	it("returns 0 and logs when matching throws", () => {
		const spy = jest.spyOn(console, "error").mockImplementation(() => {});
		const broken = {
			[Symbol.match]() {
				throw new Error("boom");
			},
		} as unknown as RegExp;

		expect(getWordCount("some text", broken)).toBe(0);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("longer documents", () => {
	it("counts a realistic note", () => {
		const text = [
			"# Weekly review",
			"",
			"%% remember to move this to the archive %%",
			"",
			"This week I didn't get through the state-of-the-art review,",
			"but I did read 3 papers and wrote 1,200 words.",
			"",
			"## Tasks",
			"- [x] Read chapter 4",
			"- [ ] Email Dr. O'Brien",
			"- [ ] Draft the outline",
			"",
			"Next week's focus is the mother-in-law problem.",
		].join("\n");

		expect(countClean(text)).toBe(29);
	});
});
