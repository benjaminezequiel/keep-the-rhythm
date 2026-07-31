# Plan: Remove Dexie, use in-memory Zustand storage

## Context

The project currently runs **two parallel storage systems** for the same data: a `data.json` on disk (the real source of truth) and a Dexie/IndexedDB table that is **cleared on every `onload`** and **rebuilt from `data.json` via `bulkPut`**, then read back via `toArray()` when persisting. The DB is never cross-session state — it's a runtime cache that just happens to be async and to require an entire migration / persistence / clear-on-unload pipeline around it.

This refactor removes Dexie entirely. The `dailyActivity: DailyActivity[]` array moves into the existing Zustand `useStore` as a new slice. Every component that used `useLiveQuery` to read DB rows becomes a plain `useMemo` over `useStore((s) => s.dailyActivity)`. Every call to `getDB().dailyActivity.xxx(...)` becomes a store action. Queries are converted from `async` to sync (no I/O left to await). Net effect: ~200 fewer lines, one fewer dependency, one fewer build plugin, no more double-source-of-truth / `clear()` / `bulkPut()` race dance.

**Outcome:** the data flow becomes a single linear path — `data.json` → `useStore.dailyActivity` (hydrated once on `onload`) → components read via selectors → mutations via store actions → rAF-coalesced `persistVersion` bump → 1s-debounced JSON save.

---

## Design decisions (confirmed with user)

- **Query functions become sync.** `getCurrentCount`, `getActivityByDate`, `getActivityByDateAndFile`, `getTotalValueByDate`, `getTotalValueInDateRange`, `getActivitiesFromLast24Hours`, `getTotalValueFromLast24Hours`, `deleteActivityFromDate`, `addDeltaToActivity` all drop `async`. Callers drop `await`.
- **Also clean up dead code in this pass:** delete `src/utils/devUtils.ts` (its only export `mockMonthDailyActivity` has no callers), remove the dead `_resetDatabase()` helper at [utils.ts#L123-126](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/utils/utils.ts#L123-L126), drop `jest`/`ts-jest`/`@types/jest`/`patch-package` from `package.json` (no test files, no `patches/` directory).

---

## Architecture changes

### New `useStore` shape

Add `dailyActivity: DailyActivity[]` and a small set of data actions. Existing slices (`today`, `currentActivity`, `settings`, `daysWithCompletedGoal`, `persistVersion`) stay.

**Invariant** the new actions must enforce: *whenever `currentActivity` is non-null, it is the same object reference as the matching row in `dailyActivity[]`*. Every mutating action checks this and updates `currentActivity` if the touched row is the current one.

New actions in [src/core/store.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/store.ts):

| Action | Purpose |
|---|---|
| `bulkSetDailyActivity(rows)` | Replace the whole array. Used by `initializeDataFromJSON` and `handleExternalSettingsChange`. Re-derives `currentActivity` from `currentFilePath`. |
| `upsertActivity(row)` | Insert or replace by `[date+filePath]`. |
| `modifyActivity(date, filePath, mutator)` | Functional update by key. |
| `deleteActivity(date, filePath)` | Remove one row. Nulls `currentActivity` if matched. |
| `deleteByFilePath(filePath)` | Remove all rows for a path (file delete / rename out of scope). |
| `renameFilePath(oldPath, newPath)` | Update `filePath` on all matching rows. |

`accumulateCurrentActivityWords` becomes a one-liner that delegates to `modifyActivity`. The 100ms `dbUpdateTimeout` debounce in [events.ts#L19-20](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/events.ts#L19-L20) becomes redundant (the store is mutated synchronously) — drop it.

`hydrateFromPluginData` also sets `dailyActivity: [...plugin.data.stats.dailyActivity]` so the store is fully populated before any view mounts.

### Queries layer

Move `src/db/queries.ts` → `src/core/dataQueries.ts`. All functions are pure (array in, value out) and sync. `getCurrentCount` reads `useStore.getState()` directly; the `QueryContext` parameter is dropped (it existed only to make React callers' `useLiveQuery` deps track the right slices — Zustand selectors do this for free).

`deleteActivityFromDate` and `addDeltaToActivity` stay as thin wrappers over store actions so existing call sites (`Entries.tsx`, `ManualEntry.tsx`) don't need to know about the store internals.

### Component reactivity

- `Slot.tsx`, `Entries.tsx`, `Heatmap.tsx` replace `useLiveQuery(..., [deps], defaultValue)` with `const x = useStore((s) => s.dailyActivity)` + `useMemo(() => derived, [x, ...otherDeps])`. The `?? 0` / `?? []` / "Loading..." fallbacks are deleted.
- `Heatmap.tsx` keeps its three-variant query (starts_with / filterFn / plain) but the data source is the array instead of `getDB().dailyActivity.where(...).xxx().toArray()`.

### Persistence pipeline

[src/core/dataPersistence.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/dataPersistence.ts):
- `initializeDataFromJSON`: replace `await getDB().dailyActivity.bulkPut(rows)` with `useStore.getState().bulkSetDailyActivity(rows)`.
- `saveDataToJSON`: replace `const dailyActivityDB = await getDB().dailyActivity.toArray()` with `useStore.getState().dailyActivity`. **Delete the "empty DB but populated stats" safety guard** (lines 61-66) — the store and `plugin.data` can no longer disagree because the store is the in-memory mirror.
- `flushToJSON`, `setupPersistenceScheduling`, the `persistVersion` subscription — unchanged.

### Lifecycle

[main.ts onload](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/main.ts#L43-L79): drop `await initDatabase()`. `initializeDataFromJSON` now also hydrates the store.

[main.ts onunload](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/main.ts#L181-L200): drop `await getDB().dailyActivity.clear()`. The "must be cleared AFTER flushToJSON" race comment is gone with the DB.

---

## Files modified

### Create
- [src/core/dataQueries.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/dataQueries.ts) — sync pure-function replacements for everything in `src/db/queries.ts` plus the two writer wrappers.

### Delete
- [src/db/db.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/db/db.ts) — entire file.
- [src/db/queries.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/db/queries.ts) — entire file (replaced by `dataQueries.ts`).
- [src/utils/devUtils.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/utils/devUtils.ts) — only export has no callers.
- The `src/db/` directory itself, once the above two are gone. `src/db/types.ts` (the `DailyActivity` type) is also deleted; `DailyActivity` is re-imported via `src/defs/types.ts` (which already imports it from `@/db/types`).

### Edit — store & data layer
- [src/core/store.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/store.ts) — add `dailyActivity` slice, 6 new actions, update `accumulateCurrentActivityWords` to delegate, update `hydrateFromPluginData`, refresh file-level docstring.
- [src/core/dataPersistence.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/dataPersistence.ts) — `initializeDataFromJSON` and `saveDataToJSON` read/write the store; delete the empty-DB safety guard; refresh doc comments.
- [src/core/commands.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/commands.ts#L13) — drop `getDB` import; read `useStore.getState().dailyActivity` instead of `toArray()`.
- [src/core/events.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/events.ts) — replace all 4 Dexie write sites (lines 255-260, 319-326, 350, 355-360) with store actions; drop `getDB` import; drop `await` from `getCurrentCount` call at line 295; drop the `dbUpdateTimeout` module-level vars (lines 19-20) and their usage (lines 197-201, 284-287); refresh doc comments.
- [src/core/externalSync.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/externalSync.ts) — `bulkPut` → `bulkSetDailyActivity`; drop `getDB` import.
- [src/utils/utils.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/utils/utils.ts) — drop `getDB` import; `getActivityByDateAndFile` becomes sync; `getExistingOrCreateNewEntry` uses `upsertActivity`; delete `_resetDatabase` (lines 123-126).
- [src/main.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/main.ts) — drop `getDB`/`initDatabase` imports, drop `initDatabase()` call (line 48), drop `getDB().dailyActivity.clear()` in `onunload` (line 199), refresh the persist-pipeline doc comment (lines 73-77).
- [src/defs/types.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/defs/types.ts#L1) — re-declare or re-export `DailyActivity` so existing `import { DailyActivity } from "@/db/types"` import sites still work (or update the 7 import sites to `@/defs/types`).

### Edit — UI components
- [src/ui/components/Slot.tsx](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/ui/components/Slot.tsx) — drop `useLiveQuery` + `getDB`; replace with `useStore((s) => s.dailyActivity)` + `useMemo(getCurrentCount, [...])`; drop `?? 0` fallbacks; refresh comments.
- [src/ui/components/Entries.tsx](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/ui/components/Entries.tsx) — same pattern: `useLiveQuery` → `useMemo` over store; switch `getActivityByDate` import to `dataQueries`; drop `entries &&` guard.
- [src/ui/components/Heatmap.tsx](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/ui/components/Heatmap.tsx) — same pattern; the three query variants become `dailyActivity.filter(...)`; delete the `if (!heatmapData) return <Loading>` branch.
- [src/ui/components/ManualEntry.tsx](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/ui/components/ManualEntry.tsx#L1) — switch `addDeltaToActivity` import to `dataQueries`; drop `await` on line 125.
- [src/ui/views/PluginView.ts](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/ui/views/PluginView.ts#L37) — comment update only ("useLiveQuery" → "store selectors").

### Edit — build / docs
- [package.json](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/package.json) — remove `dexie`, `dexie-react-hooks`, `patch-package`, `jest`, `ts-jest`, `@types/jest`. Keep `npm run build` script unchanged.
- [esbuild.config.js](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/esbuild.config.js) — delete the `dexieIsolatePlugin` object (lines 17-53) and its entry in the `plugins` array (line 94).
- [docs/project.md](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/docs/project.md) — first bullet: replace "Uses dexie.js…" with the new in-memory description.

---

## Existing patterns to reuse (don't reinvent)

- `useStore` selector pattern: `const x = useStore((s) => s.x);` — already used in `SlotWrapper.tsx#L18-19`, `Entries.tsx#L26`, `Slot.tsx#L38-42`, `SidebarView.tsx#L12-13`. New selectors follow the same style.
- `requestPersist` rAF coalescing at [store.ts#L104-115](file:///Users/chenxg/Documents/code/myCode/keep-the-rhythm/src/core/store.ts#L104-L115) — every new mutation action calls `get().requestPersist()` at the end. The 1s debounce in `setupPersistenceScheduling` already collapses keystroke storms into a single `saveDataToJSON`.
- `getDateStreaks` and `sumTimeEntries` from `utils.ts` — already pure, used as-is by `dataQueries.ts`.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `currentActivity` and `dailyActivity[]` row can diverge if a mutation forgets to update both. | All writes go through the new store actions which enforce the invariant. The single "raw" set path (`setCurrentActivity`) is reserved for `setCurrentFilePath` flow and always re-derives from the array. |
| `currentActivity` becomes a stale reference after `bulkSetDailyActivity`. | Action re-derives `currentActivity` from `dailyActivity[]` via `currentFilePath`. |
| More frequent `persistVersion` bumps (one per keystroke now vs. one per DB write). | rAF coalescing + 1s debounce in `dataPersistence.ts` already absorbs this. If the JSON write itself becomes a bottleneck, throttle in `saveDataToJSON`. Not expected to be needed. |
| `useStore.getState().today` is a string snapshot — same midnight-rollover behaviour as today. | Unchanged. Existing `focus` listener at `main.ts#L45-46` calls `checkDayChange()`. |
| Old IndexedDB left on disk for users with existing vaults. | Harmless. `data.json` was always the source of truth. The orphaned IDB database is unreferenced. |
| Dead-code cleanup (jest/patch-package) might break someone's local workflow. | `patch-package` is unused (no `patches/` dir, no `postinstall` script). `jest` has zero test files. Low risk; user opted in. |

---

## Implementation order (suggested)

1. Add the new actions + slice to `useStore` (one file, no other touch points yet).
2. Create `src/core/dataQueries.ts` as a sync mirror of the old `queries.ts`.
3. Migrate `events.ts` (4 write sites + 1 read site) — biggest behaviour change.
4. Migrate `commands.ts`, `dataPersistence.ts`, `externalSync.ts`, `utils.ts`, `manualEntry.tsx` — all small, mechanical.
5. Migrate `Slot.tsx`, `Entries.tsx`, `Heatmap.tsx` — replace `useLiveQuery` with `useMemo`.
6. Simplify `main.ts` (drop `initDatabase`, drop `clear()` in `onunload`).
7. Delete `src/db/db.ts`, `src/db/queries.ts`, `src/db/types.ts`, `src/utils/devUtils.ts`, the `src/db/` directory.
8. Update `package.json` and `esbuild.config.js`.
9. Update doc comments across the touched files.
10. Build, smoke-test.

---

## Verification

After implementation:

```bash
# Should return zero matches (modulo this plan file):
grep -rn "dexie\|getDB\|useLiveQuery\|initDatabase\|IndexedDB\|indexedDB" src/ esbuild.config.js package.json

# Should return zero matches:
grep -rn "from.*db/queries\|from.*db/db\|from.*\"dexie" src/

# Type check:
npm run build    # tsc -noEmit + esbuild production
```

Manual smoke test in Obsidian:
- First load with empty vault → all views render without "Loading…" or errors.
- Type in a note → Sidebar `Slot` (Today) and `Entries` update within ~2s; `Heatmap` cell updates immediately.
- Force-quit and reopen Obsidian → word counts survive (proves `data.json` is still the source of truth and the new pipeline round-trips it).
- Edit `data.json` from another vault while Obsidian is open → `onExternalSettingsChange` updates the in-memory store and the UI.
- Switch to a different file mid-typing → `flushPendingEditorChange` + `accumulateCurrentActivityWords` correctly attribute the last delta to the new file.
- Rename a file → all its `dailyActivity` rows update; current file pointer follows.
- Delete a file → today's contribution zeroed; entries list updates.
- Obsidian open across midnight → focus event triggers `checkDayChange`; today's counts switch to the new day.
