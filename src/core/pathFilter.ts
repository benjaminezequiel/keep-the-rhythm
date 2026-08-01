import { useStore } from "./store";

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
	return folders.some(
		(prefix: string) =>
			filePath === prefix || filePath.startsWith(prefix + "/"),
	);
}
