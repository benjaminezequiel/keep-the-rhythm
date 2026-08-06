import { useStore } from "./store";

// Cached lookup structures rebuilt only when the `trackedFolders` array
// reference changes (i.e. when the user edits the tracked-folders list).
// isPathTracked is called from handleEditorChange which fires on every
// keystroke, so the original `folders.some(prefix => filePath === prefix
// || filePath.startsWith(prefix + "/"))` did a fresh `prefix + "/"`
// allocation per folder per keystroke.  Splitting exact-match and
// descendant-match into separate structures drops the hot path to a
// Set.has + array-of-strings scan.
let _folderCache: {
	folders: string[] | undefined;
	exactSet: Set<string>;
	prefixSlashes: string[];
} | null = null;

function buildFolderCache(folders: string[]): {
	exactSet: Set<string>;
	prefixSlashes: string[];
} {
	const exactSet = new Set<string>(folders);
	const prefixSlashes = folders.map(p => p + "/");
	return { exactSet, prefixSlashes };
}

/**
 * Returns true when the given file path should be tracked according to the
 * configured `trackedFolders` setting.
 *
 * - Empty list (default) -> track the whole vault.
 * - Non-empty list -> track only files whose path equals one of the prefixes
 *   or is located directly underneath it, i.e. matches
 *   `filePath === prefix || filePath.startsWith(prefix + "/")`.
 *
 * Matching on `<prefix>/` rather than a bare `startsWith` prevents
 * `20-research` from accidentally matching `20-research-backup`.
 */
export function isPathTracked(filePath: string): boolean {
	const folders = useStore.getState().settings.trackedFolders;
	if (!folders || folders.length === 0) {
		return true;
	}

	// Rebuild cache only when the trackedFolders reference changes.
	if (!_folderCache || _folderCache.folders !== folders) {
		_folderCache = { folders, ...buildFolderCache(folders) };
	}

	const { exactSet, prefixSlashes } = _folderCache;

	if (exactSet.has(filePath)) return true;
	for (let i = 0; i < prefixSlashes.length; i++) {
		if (filePath.startsWith(prefixSlashes[i])) return true;
	}
	return false;
}
