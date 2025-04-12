import { db, type DailyActivity } from "@/db";
import React from "react";
import KeepTheRhythm from "../../main";
import { formatDate } from "../utils";
import { IntensityConfig } from "../types";
import { weeksToShow, weekdaysNames, monthNames } from "../utils";

interface HeatmapProps {
	// data: DailyActivity[];
	intensityLevels: IntensityConfig;
	// showOverview?: boolean;
	// showHeatmap?: boolean;
	// showEntries?: boolean;
	// plugin: KeepTheRhythm;
}

interface HeatmapCellProps {
	// count: number;
	intensity: number;
}

const getIntensityLevel = (
	count: number,
	intensityLevels: IntensityConfig,
): number => {
	const { low, medium, high } = intensityLevels;
	if (count <= 0) return 0;
	if (count < low) return 1;
	if (count < medium) return 2;
	if (count < high) return 3;
	return 4;
};

// INDIVIDUAL CELL
export const HeatmapCell = ({ intensity }: HeatmapCellProps) => {
	return <div className={`heatmap-square level-${intensity}`}></div>;
};

// HEATMAP
export const Heatmap = ({ intensityLevels }: HeatmapProps) => {
	const [heatmapData, setHeatmapData] = React.useState<
		Record<string, number>
	>({});

	React.useEffect(() => {
		const fetchHeatmapData = async () => {
			const requiredDates = new Set<string>();

			for (let week = 0; week < weeksToShow; week++) {
				for (let day = 0; day < 7; day++) {
					const date = getDateForCell(week, day);
					requiredDates.add(formatDate(date));
				}
			}

			const results = await db.dailyActivity
				.where("date")
				.anyOf([...requiredDates])
				.toArray();

			const dateMap: Record<string, number> = {};
			for (const entry of results) {
				dateMap[entry.date] =
					(dateMap[entry.date] || 0) + entry.wordsWritten;
			}

			setHeatmapData(dateMap);
		};
		fetchHeatmapData();
	}, []);

	const today = new Date();

	const getDayIndex = (dayIndex: number): number => {
		return dayIndex === 0 ? 6 : dayIndex - 1;
	};

	const getDateForCell = (weekIndex: number, dayIndex: number): Date => {
		const date = new Date(today);

		const currentDayIndex = getDayIndex(date.getDay());
		date.setDate(date.getDate() - currentDayIndex);

		// Calculate offset from the current week's Monday
		const weekOffset = weekIndex - (weeksToShow - 1);
		date.setDate(date.getDate() + weekOffset * 7 + dayIndex);

		return date;
	};

	const getMonthLabels = () => {
		const labels = [];
		let lastMonth = -1;

		for (let week = 0; week < weeksToShow; week++) {
			const date = getDateForCell(week, 0);

			const localDate = new Date(
				date.getTime() - date.getTimezoneOffset() * 60000,
			);
			const month = localDate.getMonth();
			const dayOfMonth = localDate.getDate();

			if (month !== lastMonth && dayOfMonth <= 7) {
				labels.push({
					month: monthNames[month],
					week: week,
				});
				lastMonth = month;
			}
		}
		return labels;
	};

	return (
		<div className="heatmap-wrapper">
			<div className="week-day-labels">
				{weekdaysNames.map((day) => (
					<div key={day} className="week-day-label">
						{day}
					</div>
				))}
			</div>

			<div className="heatmap-content">
				<div className="month-labels">
					{getMonthLabels().map(({ month, week }) => (
						<div
							key={`${month}-${week}`}
							className="month-label"
							style={{ gridColumn: week + 1 }}
						>
							{month}
						</div>
					))}
				</div>
				<div className="heatmap-new-grid">
					{Array(weeksToShow)
						.fill(null)
						.map((_, weekIndex) => (
							<div key={weekIndex} className="heatmap-column">
								{Array(7)
									.fill(null)
									.map((_, dayIndex) => {
										const date = getDateForCell(
											weekIndex,
											dayIndex,
										);
										const dateStr = formatDate(date);
										const count = heatmapData[dateStr] ?? 0;
										return (
											<HeatmapCell
												intensity={getIntensityLevel(
													count,
													intensityLevels,
												)}
											/>
										);
									})}
							</div>
						))}
				</div>
			</div>
		</div>
	);
};

// const getTodayFiles = async () => {
// 	const today = formatDate(new Date());
// 	const todayData = await db.dailyActivity
// 		.where("date")
// 		.equals(today)
// 		.toArray();

// 	// return Object.entries(todayData)
// 	// 	.filter(
// 	// 		([_, wordCount]) => wordCount.current - wordCount.initial !== 0,
// 	// 	)
// 	// 	.map(([filePath, wordCount]) => ({
// 	// 		path: filePath,
// 	// 		wordCount,
// 	// 		delta: wordCount.current - wordCount.initial,
// 	// 	}));
// };

// const getDayData = async (day: string) => {
// 	db.dailyActivity.where("date").equals(day);
// };
