---
layout: page
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

OPTIONS                                    // must always start with the OPTIONS header
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

### Available Options

- `HIDE month_labels, weekday_labels`: Hide specific labels
- `COLORING_MODE`: Set to `liquid`, `stops`, `solid`, or `gradual`
- `STOPS`: Define threshold values (e.g., `100, 500, 1000`)
- `SQUARED_CELLS` or `ROUNDED_CELLS`: Control cell appearance

## Data Slots (`ktr-slots`)

Display inline statistics with customizable metrics:

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
