---
layout: page
title: Usage
permalink: /usage/
---

# Usage

## Basic Usage

Once installed and enabled, Keep the Rhythm will automatically begin tracking your writing activity. To view your statistics:

1. Click the Keep the Rhythm icon in the left sidebar or use the command `Open sidebar view`
2. The plugin panel displays your heatmap, current statistics, and today's entries
3. Set up your preferred units and data points by hovering and clicking on each slot
4. Hover over any cell to see the exact word count of that day

## Writing Goals

Set and track your daily writing goals:

1. Define your target word count per day in the plugin's settings
2. Keep the Rhythm will track your streak of consecutive days meeting your goal
3. View your current streak in the sidebar or through embedded slots

> You can force the plugin to check previous dates when you change your writing goal by using the command `Check streak`

## Heatmap Customization

Customize your heatmap appearance with various options:

- Coloring Modes:
    - `gradual`: Smooth gradient between colors
    - `solid`: Single color intensity
    - `stops`: Discrete color levels with thresholds
    - `liquid`: Color fills cells from bottom up
- Cell Shape: Choose between **rounded** (default) or **squared** cells
- Interactive Navigation: Click cells to jump to daily notes (uses Obsidian's core plugin _Daily Notes_)

## Data Slots

Display various writing statistics using customizable slots:

- Current: `CURRENT_FILE`, `CURRENT_DAY`, `CURRENT_WEEK`, `CURRENT_MONTH`, `CURRENT_YEAR`
    - These are dynamic ranges calculated based on the start of the day/week/year
- Historical Stats: `LAST_DAY`, `LAST_WEEK`, `LAST_MONTH`, `LAST_YEAR`
    - These are calculated based on discrete ranges (24h, 7d, 30d, 365d)
- Goal Tracking: `CURRENT_STREAK`
- Vault Overview: `WHOLE_VAULT`

**Options**:

- Specify `WORDS` or `CHARS` for the count unit
- Add `AVG` for average calculations where applicable
