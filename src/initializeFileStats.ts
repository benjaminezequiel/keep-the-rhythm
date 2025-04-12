import { db, FileStats } from "./db";
import { Vault } from "obsidian";
import { getExternalWordCount } from "./wordCounting";
import { Language } from "./types";

// Iterates over all files and updates fileStats database
// TODO: Research if it's more performant to update everything always or check if something changed first.
// TODO: Create charCount functionality (user request)

export async function initializeFileStats(
	vault: Vault,
	enabledLanguages: Language[],
) {
	const t0 = performance.now();
	const files = vault.getMarkdownFiles();
	// db.fileStats.toCollection().modify({ toDelete: true });

	for (let i = 0; i < files.length; i++) {
		const fileContent = await vault.cachedRead(files[i]);
		const [fileWordCount, fileCharCount] = await getFileWordAndCharCount(
			fileContent,
			enabledLanguages,
		);

		// properly check if the file entry already exists, add it if it doesn't and update it if it does
		const dbEntry = await db.fileStats
			.where("path")
			.equalsIgnoreCase(files[i].path)
			.first();

		if (!dbEntry) {
			const file: FileStats = {
				path: files[i].path,
				filename: files[i].basename,
				wordCount: fileWordCount,
				charCount: fileCharCount,
				created: new Date(files[i].stat.ctime * 1000),
				lastModified: new Date(files[i].stat.mtime * 1000),
				timesOpened: 0,
			};
			db.fileStats.add(file);
		} else {
			await db.fileStats.update(dbEntry.id as number, {
				wordCount: fileWordCount,
				charCount: fileCharCount,
				created: new Date(files[i].stat.ctime * 1000),
				lastModified: new Date(files[i].stat.mtime * 1000),
			});
		}
	}
	// Deletes a entry if it's on the database but doesn't exist anymore
	// await db.fileStats.where("toDelete").equals(1).delete();
	const t1 = performance.now();

	console.info(
		`%cKEEP THE RHYTHM%cFile index initialized in ${Math.round(t1 - t0)} milliseconds.`,
		"font-weight: bold; color: purple;",
		"font-weight: normal",
	);
}

// I was considering using external word counting libraries, but the alfaaz one I tried doesn't pass the tests I established for the project
// I'll probably need a more performant solution instead of a bunch of regexes eventually tho

async function getFileWordAndCharCount(
	fileContent: string,
	enabledLanguages: Language[],
) {
	const wordCount = getExternalWordCount(fileContent, enabledLanguages);
	const charCount = fileContent.length;
	return [wordCount, charCount];
}
