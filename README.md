# Keep the Rhythm2

Keep the Rhythm2 is an Obsidian plugin that helps you maintain a consistent writing habit by tracking your daily word count, setting writing goals and visualizing data through a heatmap and customizable code blocks.

> This branch is a major internal rework compared to upstream `keep-the-rhythm` **v0.2.12** (commit `440c357`). It is distributed under the new id `keep-the-rhythm2` (v0.5.0). See [What Changed vs. v0.2.12](#what-changed-vs-v0212) for a summary of the differences.

![image](https://github.com/user-attachments/assets/8acd047d-68da-42d0-835d-6c7ab55b6f65)

## Features

- **Writing Stats**: Automatically tracks how many words you write each day in Obsidian

- **Goals & Streaks**: Set daily writing goals and track your streak of consecutive days meeting your target

- **Heatmap**: View your writing activity over time (helps with consistency and motivation)
- **Custom Slots**: Various writing statistics (written today, this week, avg. this year, etc.)
- **Entries by Day**: Easily check and navigate to files you have worked on today

- **Embedded Components**: Insert heatmaps, slots, and entries widgets into any note using custom code blocks
- **Advanced Filtering**: Filter your writing statistics with the query syntax for specific folders or file patterns
- **Tracking Scope**: Restrict all tracking to a subset of the vault by listing folders (see [Tracking Scope](#tracking-scope))
- **Multi-device Sync**: Syncs and merges statistics across different devices
- **Compressed Storage**: Historical data is dictionary-encoded (file paths → small IDs), cutting persisted size by ~60–65% for multi-month histories (see [Storage](#storage-and-migration))

## Installation

#### MANUAL INSTALLATION

Download the latest release files from this repository's Releases section
Create a folder at /.obsidian/plugins/ named keep-the-rhythm2
Reload Obsidian
Go to Settings > Community Plugins and enable "Keep the Rhythm2"

---

## Usage

### Basic Usage

Once installed and enabled, Keep the Rhythm2 will automatically begin tracking your writing activity. To view your statistics:

1. Click the Keep the Rhythm2 icon in the left sidebar or use the command `Open sidebar view`
2. The plugin panel displays your heatmap, current statistics, and today's entries
3. Set up your preferred data points by hovering and clicking on each slot
4. Hover over any cell to see the exact word count of that day

### Writing Goals

Set and track your daily writing goals:

1. Define your target word count per day in the plugin's settings
2. Keep the Rhythm2 will track your streak of consecutive days meeting your goal
3. View your current streak in the sidebar or through embedded slots

> You can force the plugin to check previous dates when you change your writing goal by using the command `Check streak`

### Tracking Scope

By default Keep the Rhythm tracks every markdown file in the vault. Set a **Tracked Folders** list in Settings -> General to restrict tracking to specific folders.

Add one folder at a time: type the folder path (e.g. `20-research`) into the input and click **Add** (or press Enter). Each added folder shows up as a row with a trash button; click the trash button to remove it.

Matching rules:

- A file is tracked when its path equals one of the configured folders or starts with `<folder>/`.
- `20-research` matches `20-research/notes.md` and `20-research/sub/deep.md`, but **not** `20-research-backup/notes.md` (boundary respected).
- Nested folders are supported: `20-research/notes` only tracks files under `20-research/notes/`.
- An empty list tracks the whole vault (default behaviour).

When the list is non-empty, the following behaviour changes:

- Edits to files outside the scope are ignored (no `dailyActivity` entry is created)
- Files outside the scope are excluded from the `WHOLE_VAULT` count
- Renaming a file out of the scope removes its historical activity
- The heatmap, streak, daily goal, and sidebar slots all reflect only the in-scope files

### Heatmap Customization

Customize your heatmap appearance with various options:

- Coloring Modes:
    - `gradual`: Smooth gradient between colors
    - `solid`: Single color intensity
    - `stops`: Discrete color levels with thresholds
    - `liquid`: Color fills cells from bottom up
- Cell Shape: Choose between **rounded** (default) or **squared** cells
- Interactive Navigation: Click cells to jump to daily notes (uses Obsidian's core plugin _Daily Notes_)


### Data Slots

Display various writing statistics using customizable slots:

- Current: CURRENT_DAY, CURRENT_WEEK, CURRENT_MONTH, CURRENT_YEAR
    - These are dynamic ranges calculated based on the start of the day/week/year
- Historical Stats: LAST_DAY, LAST_WEEK, LAST_MONTH, LAST_YEAR
    - These are calculated based on discrete ranges (2d, 7d, 30d, 365d)
- Goal Tracking: CURRENT_STREAK

> Note: `CURRENT_FILE` and `WHOLE_VAULT` were removed in this branch.

### Code Blocks

Keep the Rhythm provides three types of embeddable code blocks.

> A block can be created by using the code block syntax (3 backticks on start and end) and a keyword to specify the block type.

#### Heatmap (`ktr-heatmap`)

Embed customizable heatmaps with filtering and display options:

````
```ktr-heatmap
filePath starts_with "journal"

OPTIONS                                    // must always start with the OPTIONS header
HIDE month_labels, weekday_labels          // allows to hide the labels
COLORING_MODE liquid                       // toggles the coloring mode (liquid, stops, solid or gradual)
STOPS 100, 500, 1000                       // changes the keypoints used for calculating the color of the cells
SQUARED_CELLS                              // changes the cell styling for a more squared look
ROUNDED_CELLS                              // changes the cell styling for a rounded look
WEEKS 24                                   // changes how many weeks are displayed (can affect performance)
```
````

Query Syntax:

- Filter by file path: `filePath starts_with "folder_name"`
- Compose queries: `(filePath starts_with "journal") OR (filePath starts_with "worldbuilding")`

Available Options:

- `HIDE month_labels, weekday_labels`: Hide specific labels
- `COLORING_MODE`: Set to `liquid`, `stops`, `solid`, or `gradual`
- `STOPS`: Define threshold values (e.g., `100, 500, 1000`)
- `SQUARED_CELLS` or `ROUNDED_CELLS`: Control cell appearance

#### Data Slots (`ktr-slots`)

Display inline statistics with customizable metrics:

````
```ktr-slots
CURRENT_WEEK
CURRENT_DAY, WORDS
CURRENT_STREAK
CURRENT_MONTH, WORDS, AVG
CURRENT_YEAR
```
````

Available Slots:

- CURRENT_STREAK: displays the amount of sequential days where writing goal was completed
- CURRENT_DAY: displays the amount written from the start of the day until now
- CURRENT_WEEK: displays the amount from the start of the week (currently defined as Monday, I'll add a setting soon)
- CURRENT_MONTH: displays the amount from the start of the month
- CURRENT_YEAR: displays the amount from the start of the year
- LAST_DAY: amount written in the last 2 days
- LAST_WEEK: amount written in the last 7 days
- LAST_MONTH: amount written in the last 30 days
- LAST_YEAR: amount written in the last 365 days

**Options**:

- Add AVG for average calculations where applicable (only word counts are tracked; `CHARS` was removed)

#### Daily Entries (`ktr-entries`)

Display writing activity for specific dates:

````
```ktr-entries
2026-08-01
```
````

Shows the activity for the specified date (`YYYY-MM-DD` format). If no date is provided, displays the current date's activity.

## Settings and Customization

Access comprehensive customization options through the plugin settings:

- Set daily writing goals and track streaks
- Configure heatmap appearance (coloring, cell shapes, labels, custom start date)
- Configure which writing systems to count (`Enabled Languages`, including `Chinese` / CJK)
- Set an **Editor Change Sample Delay** (seconds to wait after typing stops before sampling content)
- Manage **Tracked Folders** via a dedicated popup manager
- Toggle visibility of different plugin components
- Configure automatic backups

## Storage and Migration

Data is stored **locally** in `data.json` inside the plugin's data folder — nothing is sent to external servers.

Since this branch, historical activity is stored as a **dictionary-encoded** map: file paths are replaced by small integer IDs in `days`, and a separate `fileDict` maps IDs back to paths. `today` activity is kept in a separate partition (`todayBaselines`). This reduces the size of multi-month histories by roughly 60–65%.

Old-format data (from the Dexie-based v0.2.12 / `440c357`) is **migrated automatically** on load — you don't need to do anything manually.

## What Changed vs. v0.2.12

This branch is a large internal rework of the upstream `keep-the-rhythm` (commit `440c357`, v0.2.12). The plugin is now published as **Keep the Rhythm2** (`keep-the-rhythm2`, v0.5.0). Highlights:

**Architecture & storage**
- Removed the **Dexie** database (`src/db/`) in favor of a single JSON file (`data.json`) with dictionary-encoded, cache-friendly structures.
- Replaced the manual event/refresh system with a **Zustand store** (`src/core/store.ts`) for centralized, reactive state.
- Split activity into **today** and **historical** partitions with separate caches, and removed the redundant per-day rows in favor of a `wordsAdded`/`charsAdded` shape.
- Added a dedicated **stats codec** (`src/core/statsCodec.ts`) that owns the persisted ↔ runtime shape and transparently migrates legacy data.
- Added new modules for persistence (`dataPersistence.ts`), queries (`dataQueries.ts`), and external multi-device sync (`externalSync.ts`).
- Dropped the `moment` dependency in favor of native date utilities.

**Removed features**
- `CURRENT_FILE` and `WHOLE_VAULT` slots.
- Character (`CHARS`) counting and the unit selector — only **word counts** are tracked now.
- Repository-scoped code (`pluginState.ts`, `devUtils.ts`, `migrateData.ts`).

**Added / improved**
- **Tracked Folders** setting with a popup manager (`TrackedFoldersSetting.ts`) and path-filtering cache, to restrict tracking to a subset of the vault.
- **Editor Change Sample Delay** setting (seconds to wait after typing stops before sampling content) with adjustable JSON persistence debounce (2000 ms).
- **Chinese** option in Enabled Languages (LATIN + CJK scripts).
- Automatic **backups** (`backup.ts`).
- Caching & `React.memo` throughout heatmap, entries, tooltip and slots to reduce re-renders.
- Heatmap option to align cells left; `LAST_DAY` now reports the last **2 days** instead of 24 hours.
- Active-file tracking with an `activeFiles` set for efficient rename handling.

> Note: this branch is **not interchangeable** data-wise with v0.2.12 for the storage format, but legacy Dexie data is migrated automatically on first load. If you previously used v0.2.12, your history will be preserved.

## Data and Privacy

Keep the Rhythm2 **stores all data locally** in your Obsidian vault. No data is sent to external servers. Your writing statistics are saved in a JSON file within the plugin's data directory.

## Support

If you encounter any issues or have suggestions for improvements, please:

1. Check the GitHub Issues to see if your issue has already been reported
2. Create a new issue if needed, providing as much detail as possible

## FAQ

#### Why not use Better Word Count?

I built this plugin after finding that Better Word Count, while useful, had issues with Obsidian Sync - stats would get overwritten when switching between devices.
Keep the Rhythm solves this by properly saving and merging data across devices, ensuring your writing progress is always accurately tracked!

#### Why is there a separate version (Keep the Rhythm2)?

This branch exists to address two key limitations of the original plugin:

- **Performance**: As writing history grows over months and years, the original architecture became increasingly slow. Activity data was stored as a flat array of rows, causing the plugin to reprocess large datasets on every interaction. Keep the Rhythm2 replaces this with a Zustand-based reactive store and dictionary-encoded storage, dramatically reducing re-renders and lookup times.

- **Storage efficiency**: The original format not only duplicated full file paths on every activity entry, but also stored per-file, per-5-minute word-count deltas — creating a massive volume of fine-grained records that grew quickly. Keep the Rhythm2 eliminates this overhead by removing redundant delta tracking, replacing it with dictionary-encoded daily aggregates and split hot/cold partitions. The net result is a reduction of well over 60% in `data.json` size for long-term users — while preserving all meaningful writing history through automatic migration.
