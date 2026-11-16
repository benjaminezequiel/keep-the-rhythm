# Keep the Rhythm

Keep the Rhythm is an Obsidian plugin that helps you maintain a consistent writing habit by tracking your daily word count, setting writing goals and visualizing data through a heatmap and customizable code blocks.

![image](https://github.com/user-attachments/assets/8acd047d-68da-42d0-835d-6c7ab55b6f65)

## Features

- **Writing Stats**: Automatically tracks how many words/characters you write each day in Obsidian

- **Goals & Streaks**: Set daily writing goals and track your streak of consecutive days meeting your target

- **Heatmap**: View your writing activity over time (helps with consistency and motivation)
- **Custom Slots**: Various writing statistics (written today, this week, avg. this year, etc.)
- **Entries by Day**: Easily check and navigate to files you have worked on today

- **Embedded Components**: Insert heatmaps, slots, and entries widgets into any note using custom code blocks
- **Advanced Filtering**: Filter your writing statistics with the query syntax for specific folders or file patterns

- **Multi-device Sync**: Syncs and merges statistics across different devices

## Installation

#### RECOMMENDED!

Install through the Community Plugins section in Obsidian's settings

#### MANUAL INSTALLATION

Download the latest release files from this repository's Releases section
Create a folder at /.obsidian/plugins/ named keep-the-rhythm
Reload Obsidian
Go to Settings > Community Plugins and enable "Keep the Rhythm"

---

## Usage

### Basic Usage

Once installed and enabled, Keep the Rhythm will automatically begin tracking your writing activity. To view your statistics:

1. Click the Keep the Rhythm icon in the left sidebar or use the command `Open sidebar view`
2. The plugin panel displays your heatmap, current statistics, and today's entries
3. Set up your preferred units and data points by hovering and clicking on each slot
4. Hover over any cell to see the exact word count of that day

### Writing Goals

Set and track your daily writing goals:

1. Define your target word count per day in the plugin's settings
2. Keep the Rhythm will track your streak of consecutive days meeting your goal
3. View your current streak in the sidebar or through embedded slots

> You can force the plugin to check previous dates when you change your writing goal by using the command `Check streak`

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

- Current: CURRENT_FILE, CURRENT_DAY, CURRENT_WEEK, CURRENT_MONTH, CURRENT_YEAR
    - These are dynamic ranges calculated based on the start of the day/week/year
- Historical Stats: LAST_DAY, LAST_WEEK, LAST_MONTH, LAST_YEAR
    - These are calculated based on discrete ranges (24h, 7d, 30d, 365d)
- Goal Tracking: CURRENT_STREAK
- Vault Overview: WHOLE_VAULT

### Code Blocks

Keep the Rhythm provides three types of embeddable code blocks.

> A block can be created by using the code block syntax (3 backticks on start and end) and a keyword to specify the block type.

#### Heatmap (`ktr-heatmap`)

Embed customizable heatmaps with filtering and display options:

```js
filePath starts_with "journal"

OPTIONS                                    // optional header before display options
HIDE month_labels, weekday_labels          // allows to hide the labels
COLORING_MODE liquid                       // toggles the coloring mode (liquid, stops, solid or gradual)
STOPS 100, 500, 1000                       // changes the keypoints used for calculating the color of the cells
SQUARED_CELLS                              // changes the cell styling for a more squared look
ROUNDED_CELLS                              // changes the cell styling for a rounded look
WEEKS 24                                   // changes how many weeks are displayed (can affect performance)
```

Query Syntax:

- Filter by file path: `filePath starts_with "folder_name"`
- Compose queries: `(filePath starts_with "journal") OR (filePath starts_with "worldbuilding")`

Filters are local to each code block. They do not affect other blocks in the note or the sidebar. Use a trailing `/` to match a folder and its contents, for example `filePath starts_with "journal/"`. Paths are relative to the vault and case-sensitive.

Heatmaps accept filters and display options such as `WEEKS 26` and `UNIT WORDS`. Statistics such as `CURRENT_WEEK, WORDS` belong in a separate `ktr-slots` block. Invalid filters and misplaced slot lines display an error instead of falling back to vault-wide totals.

Available Options:

- `HIDE month_labels, weekday_labels`: Hide specific labels
- `COLORING_MODE`: Set to `liquid`, `stops`, `solid`, or `gradual`
- `STOPS`: Define threshold values (e.g., `100, 500, 1000`)
- `SQUARED_CELLS` or `ROUNDED_CELLS`: Control cell appearance

#### Data Slots (`ktr-slots`)

Display inline statistics with customizable metrics:

To limit every statistic in a block to a folder, put a `filePath` filter before the slots:

```ktr-slots
filePath starts_with "Stories/My Novel/"

CURRENT_DAY, WORDS
CURRENT_WEEK, WORDS
CURRENT_MONTH, WORDS, AVG
LAST_MONTH, WORDS
WHOLE_VAULT, WORDS
```

Repeat the filter in each block you want to scope. Slot filters support `filePath` comparisons, `starts_with`, `contains`, and conditions joined with `AND`, `OR`, or `!`. `WORDS`/`CHARS` and `WORD`/`CHAR` are accepted. Averages, streaks, and weekly goal indicators use only matching activity. With a filter, `WHOLE_VAULT` counts the current content of matching Markdown files; `CURRENT_FILE` returns zero when the active file does not match. Without a filter, statistics retain their usual vault-wide scope.

An unfiltered block can include:

```ktr-slots
CURRENT_WEEK, WORDS
CURRENT_DAY, CHARS
CURRENT_STREAK
WHOLE_VAULT
CURRENT_MONTH, WORDS, AVG
CURRENT_YEAR
```

Available Slots:

- CURRENT_FILE: displays the current file count
- CURRENT_STREAK: displays the amount of sequential days where writing goal was completed
- CURRENT_DAY: displays the amount written from the start of the day until now
- CURRENT_WEEK: displays the amount from the start of the week (currently defined as Monday, I'll add a setting soon)
- CURRENT_MONTH: displays the amount from the start of the month
- CURRENT_YEAR: displays the amount from the start of the year
- LAST_DAY: amount written in the last 24 hours
- LAST_WEEK: amount written in the last 7 days
- LAST_MONTH: amount written in the last 30 days
- LAST_YEAR: amount written in the last 365 days
- WHOLE_VAULT: amount written in every markdown file in the vault

**Options**:

- Specify WORDS or CHARS for the count unit
- Add AVG for average calculations where applicable

#### Daily Entries (`ktr-entries`)

Display writing activity for specific dates:

```ktr-entries
2024-03-15
```

Shows the activity for the specified date (`YYYY-MM-DD` format). If no date is provided, displays the current date's activity.

## Settings and Customization

Access comprehensive customization options through the plugin settings:

- Set daily writing goals and track streaks
- Configure heatmap appearance (coloring, cell shapes, labels)
- Toggle visibility of different plugin components

## Data and Privacy

Keep the Rhythm **stores all data locally** in your Obsidian vault. No data is sent to external servers. Your writing statistics are saved in a JSON file within the plugin's data directory.

## Support

If you encounter any issues or have suggestions for improvements, please:

1. Check the GitHub Issues to see if your issue has already been reported
2. Create a new issue if needed, providing as much detail as possible

## FAQ

#### Why not use Better Word Count?

I built this plugin after finding that Better Word Count, while useful, had issues with Obsidian Sync - stats would get overwritten when switching between devices.
Keep the Rhythm solves this by properly saving and merging data across devices, ensuring your writing progress is always accurately tracked!
