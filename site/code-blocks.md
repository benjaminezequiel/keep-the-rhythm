---
layout: default
title: Code Blocks
permalink: /code-blocks/
---

# Code Blocks

Keep the Rhythm provides three types of embeddable code blocks.

> A block can be created by using the code block syntax (3 backticks on start and end) and a keyword to specify the block type.

## Heatmap (`ktr-heatmap`)

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

### Query Syntax

- Filter by file path: `filePath starts_with "folder_name"`
- Compose queries: `(filePath starts_with "journal") OR (filePath starts_with "worldbuilding")`

Filters are local to each code block. They do not affect other blocks in the note or the sidebar. Use a trailing `/` to match a folder and its contents, for example `filePath starts_with "journal/"`. Paths are relative to the vault and case-sensitive.

Heatmaps accept filters and display options such as `WEEKS 26` and `UNIT WORDS`. Statistics such as `CURRENT_WEEK, WORDS` belong in a separate `ktr-slots` block. Invalid filters and misplaced slot lines display an error instead of falling back to vault-wide totals.

### Available Options

- `HIDE month_labels, weekday_labels`: Hide specific labels
- `COLORING_MODE`: Set to `liquid`, `stops`, `solid`, or `gradual`
- `STOPS`: Define threshold values (e.g., `100, 500, 1000`)
- `SQUARED_CELLS` or `ROUNDED_CELLS`: Control cell appearance

## Data Slots (`ktr-slots`)

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

```
CURRENT_WEEK, WORDS
CURRENT_DAY, CHARS
CURRENT_STREAK
WHOLE_VAULT
CURRENT_MONTH, WORDS, AVG
CURRENT_YEAR
```

See the [full list of available slots]({{ '/usage/#data-slots' | relative_url }}) on the Usage page.

## Daily Entries (`ktr-entries`)

Display writing activity for specific dates:

```
2024-03-15
```

Shows the activity for the specified date (`YYYY-MM-DD` format). If no date is provided, displays the current date's activity.
