import type KeepTheRhythm from "@/main";

/**
 * Service-locator for the Obsidian plugin instance.
 *
 * `plugin` is NOT reactive state — it's set once in `onload()` and never
 * changes.  It therefore doesn't belong in the Zustand store (which would
 * cause spurious re-renders whenever any component subscribes to a slice
 * that happens to share the same shallow-equality boundary).
 *
 * Non-React modules (events.ts, queries.ts, utils.ts, …) call `getPlugin()`
 * to access `app`, `vault`, `workspace`, `data`, `saveData`, etc.
 */
let plugin: KeepTheRhythm | null = null;

export function setPlugin(p: KeepTheRhythm): void {
  plugin = p;
}

export function getPlugin(): KeepTheRhythm {
  if (!plugin) {
    throw new Error(
      "KeepTheRhythm plugin not initialized. Call setPlugin() in onload().",
    );
  }
  return plugin;
}
