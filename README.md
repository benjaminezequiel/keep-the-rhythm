# Keep the Rhythm

Keep the Rhythm is an Obsidian plugin that helps you maintain a consistent writing practice by tracking your daily word count and visualizing it through an elegant heatmap.

![plugin-heatmap](docs/image.png)

### Why not use Better Word Count?

I built this plugin after finding that [Better Word Count](https://github.com/lukeleppan/better-word-count/), while useful, had issues with Obsidian Sync - stats would get overwritten when switching between devices.
Keep the Rhythm solves this by properly saving and merging data through devices, ensuring your writing progress is always accurately tracked.

## Features

- Daily Word Count Tracking: Automatically tracks how many words you write each day in Obsidian
- Visual Heatmap: Data visualization showing your writing activity over time
- Progress at a Glance: Quickly see your most productive writing days and identify patterns in your writing habits
- Today's Entries View: Inspect and manage files tracked in the current day, with the ability to delete individual entries
- Embedded Heatmaps: Insert heatmaps into any note using custom code blocks with powerful filtering options
- Customizable Display: Toggle visibility of heatmap and today's entries through settings
- Path Filtering: Filter your writing statistics to focus on specific folders or file patterns
- Multi-device Sync: Seamlessly syncs and merges statistics across different devices

## Installation
RECOMMENDED
- You can install the plugin through the Community Plugins section, inside Obsidian's settings
  
MANUAL INSTALLATION
- Download the latest release files from this repository's Releases section
- Create a folder on `/.obsidian/plugins/` named `keep-the-rhythm`
- Reload Obsidian
- Go to Settings > Community Plugins and enable "Keep the Rhythm"

## Usage
#### **Basic Usage**
Once installed and enabled, Keep the Rhythm will automatically begin tracking your writing activity. To view your heatmap:

- Click the Keep the Rhythm icon in the left sidebar
- The heatmap will display in the right panel, showing your writing activity
- Hover over any day to see the exact word count

#### **Embedded Heatmaps**
You can embed heatmaps directly in your notes using code blocks:

```
	```keep-the-rhythm
	```
```

To filter data for specific paths:
```
	```keep-the-rhythm
		PATH includes "daily"
	```
```


#### **Display Options**
You can customize the plugin's display through settings:
- Toggle heatmap visibility
- Toggle today's entries visibility
- Adjust color schemes and intensity levels

Toggling sections can also be made through the code blocks:

```
	```keep-the-rhythm
		HIDE overview
		HIDE heatmap
		HIDE entries
	```
```

#### **Managing data tracking for the current day**
Through the "TODAY ENTRIES" section, you can:
- View all files tracked today
- Delete individual entries if needed
- Monitor real-time progress for each file


## Data and Privacy

Keep the Rhythm stores all data locally in your Obsidian vault. No data is sent to external servers. Your writing statistics are saved in a JSON file within the plugin's data directory.
The plugin supports Obsidian's sync functionality by maintaining separate statistics for each device and intelligently merging them to prevent data loss.

## License

[MIT License](LICENSE)

## Support

If you encounter any issues or have suggestions for improvements, please:

1. Check the [GitHub Issues](https://github.com/yourusername/keep-the-rhythm/issues) to see if your issue has already been reported
2. Create a new issue if needed, providing as much detail as possible
