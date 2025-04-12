import { getWordCount, createRegex } from "../src/wordCounting";
import { Language } from "../src/types";

describe("Word counting", () => {
	const defaultScripts: Language[] = ["LATIN", "CJK", "JAPANESE", "KOREAN"];
	let regex: RegExp;

	beforeEach(() => {
		regex = createRegex(defaultScripts);
	});

	test("handles empty and whitespace input", () => {
		expect(getWordCount("", regex)).toBe(0);
		expect(getWordCount("   ", regex)).toBe(0);
		expect(getWordCount("\n\t  \r", regex)).toBe(0);
		expect(getWordCount(null as any, regex)).toBe(0);
		expect(getWordCount(undefined as any, regex)).toBe(0);
	});

	test("counts basic Latin words", () => {
		expect(getWordCount("Hello world", regex)).toBe(2);
		expect(getWordCount("This is a test", regex)).toBe(4);
		expect(getWordCount("Multiple   spaces   between   words", regex)).toBe(
			4,
		);
	});

	test("handles numbers within words", () => {
		expect(getWordCount("Test123", regex)).toBe(1);
		expect(getWordCount("Mid123Word", regex)).toBe(1);
		expect(getWordCount("Test123 Word456", regex)).toBe(2);
		expect(getWordCount("1.234,56", regex)).toBe(1);
		expect(getWordCount("1.234,56 test", regex)).toBe(2);
	});

	test("counts CJK characters individually", () => {
		expect(getWordCount("你好", regex)).toBe(2);
		expect(getWordCount("我爱编程", regex)).toBe(4);
		expect(getWordCount("中文123", regex)).toBe(3);
		expect(getWordCount("你好world", regex)).toBe(3);
	});

	test("counts Japanese characters individually", () => {
		expect(getWordCount("こんにちは", regex)).toBe(5);
		expect(getWordCount("すし", regex)).toBe(2);
		expect(getWordCount("ラーメン", regex)).toBe(4);
		expect(getWordCount("東京", regex)).toBe(2);
	});

	test("counts Korean characters individually", () => {
		expect(getWordCount("안녕하세요", regex)).toBe(5);
		expect(getWordCount("테스트", regex)).toBe(3);
		expect(getWordCount("한글123", regex)).toBe(3);
	});

	test("handles mixed scripts correctly", () => {
		expect(getWordCount("Hello 你好 World こんにちは", regex)).toBe(9); // 2 Latin + 2 CJK + 5 Japanese
		expect(getWordCount("Test123 테스트 test", regex)).toBe(5); // 1 Latin+num + 3 Korean + 1 Latin
		expect(getWordCount("Hello世界test123", regex)).toBe(4); // 1 Latin + 2 CJK + 1 Latin+num
		expect(getWordCount("Angular框架", regex)).toBe(3);
		expect(getWordCount("React테스트", regex)).toBe(4);
	});

	test("respects script configuration", () => {
		const latinOnly = createRegex(["LATIN"]);
		expect(getWordCount("Hello 你好 World", latinOnly)).toBe(2);

		const cjkOnly = createRegex(["CJK"]);
		expect(getWordCount("Hello 你好 World", cjkOnly)).toBe(2);

		const japaneseOnly = createRegex(["JAPANESE"]);
		expect(getWordCount("Hello こんにちは World", japaneseOnly)).toBe(5);

		const latinAndCJK = createRegex(["LATIN", "CJK"]);
		expect(getWordCount("Hello 你好 World", latinAndCJK)).toBe(4);
	});

	test("handles special characters and punctuation", () => {
		expect(getWordCount("hello_world", regex)).toBe(1);
		expect(getWordCount("hello-world", regex)).toBe(1);
		expect(getWordCount("hello.world", regex)).toBe(2);
		expect(getWordCount("hello,world", regex)).toBe(2);
		expect(getWordCount("hello:world", regex)).toBe(2);
		expect(getWordCount("hello@world", regex)).toBe(2);
	});
});
