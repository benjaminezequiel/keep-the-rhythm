import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	TooltipProvider,
} from "../components/ui/tooltip";

import { ButtonComponent } from "obsidian";
import React from "react";
import { Stats, IntensityConfig } from "../types";
import { Overview } from "./Overview";
import { getCurrentDate } from "@/utils";
import WordCountPlugin from "main";
import { getFileNameWithoutExtension } from "@/utils";

const formatDate = (date: Date): string => {
	return (
		date.getFullYear() +
		"-" +
		String(date.getMonth() + 1).padStart(2, "0") +
		"-" +
		String(date.getDate()).padStart(2, "0")
	);
};

interface HeatmapProps {
	data: Stats;
	intensityLevels: IntensityConfig;
	showOverview?: boolean;
	showHeatmap?: boolean;
	showEntries?: boolean;
	plugin: WordCountPlugin;
}

interface HeatmapCellProps {
	date: string;
	count: number;
	intensityLevels: IntensityConfig;
}

const HeatmapCell = ({ date, count, intensityLevels }: HeatmapCellProps) => {
	const getIntensityLevel = (count: number): number => {
		const { low, medium, high } = intensityLevels;
		if (count <= 0) return 0;
		if (count < low) return 1;
		if (count < medium) return 2;
		if (count < high) return 3;
		return 4;
	};

	const [year, month, day] = date.split("-").map(Number);
	const localDate = new Date(year, month - 1, day);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={`heatmap-square level-${getIntensityLevel(count)}`}
				/>
			</TooltipTrigger>
			<TooltipContent className="custom-tooltip">
				<div className="tooltip-date">
					{formatDate(new Date(localDate))}
				</div>
				<div className="tooltip-wordCount">+{count} words</div>
			</TooltipContent>
		</Tooltip>
	);
};

export const Heatmap = ({
	data,
	intensityLevels,
	showOverview = true,
	showEntries = true,
	showHeatmap = true,
	plugin,
}: HeatmapProps) => {
	const today = new Date();
	const weeksToShow = 52;
	const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const monthNames = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];

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

	const getTodayFiles = () => {
		const today = getCurrentDate();
		const todayData = data[today]?.files || [];

		return Object.entries(todayData)
			.filter(
				([_, wordCount]) => wordCount.current - wordCount.initial !== 0,
			)
			.map(([filePath, wordCount]) => ({
				path: filePath,
				wordCount,
				delta: wordCount.current - wordCount.initial,
			}));
	};

	const getMonthLabels = () => {
		const labels = [];
		let lastMonth = -1;

		for (let week = 0; week < weeksToShow; week++) {
			const date = getDateForCell(week, 0);
			// Get local date
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
		<div className="component-wrapper">
			{showOverview && <Overview data={data} />}
			{showHeatmap && (
				<TooltipProvider>
					<div className="heatmap-wrapper">
						<div className="heatmap-container">
							<div className="week-day-labels">
								{days.map((day) => (
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
											<div
												key={weekIndex}
												className="heatmap-column"
											>
												{Array(7)
													.fill(null)
													.map((_, dayIndex) => {
														const date =
															getDateForCell(
																weekIndex,
																dayIndex,
															);

														const dateStr =
															formatDate(date);

														const dayData =
															data?.[dateStr];

														let count = 0;

														if (
															dayData &&
															dayData.totalDelta
														) {
															count =
																dayData?.totalDelta;
														}

														return (
															<HeatmapCell
																key={dayIndex}
																date={dateStr}
																count={count}
																intensityLevels={
																	intensityLevels
																}
															/>
														);
													})}
											</div>
										))}
								</div>
							</div>
						</div>
					</div>
				</TooltipProvider>
			)}
			{showEntries && (
				<div className="todayEntries__section">
					<div className="todayEntries__section-title">
						TODAY ENTRIES
					</div>
					{getTodayFiles().length > 0 ? (
						getTodayFiles().map((file) => (
							<div
								key={file.path}
								className="todayEntires__list-item"
							>
								<span className="todayEntries__file-path">
									{getFileNameWithoutExtension(file.path)}
								</span>
								<div className="todayEntries__list-item-right">
									<span className="todayEntries__word-count">
										{file.delta > 0
											? `+${file.delta}`
											: file.delta}{" "}
										words
									</span>
									<button
										className="todayEntries__delete-button"
										onClick={() =>
											plugin.handleDeleteEntry(file.path)
										}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="24"
											height="24"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor" // This ensures the icon uses the current text color
											strokeWidth="2" // React uses camelCase for attributes like 'stroke-width'
											strokeLinecap="round"
											strokeLinejoin="round"
											className="svg-icon"
										>
											<path d="M3 6h18" />
											<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
											<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
											<line
												x1="10"
												y1="11"
												x2="10"
												y2="17"
											/>
											<line
												x1="14"
												y1="11"
												x2="14"
												y2="17"
											/>
										</svg>
									</button>
								</div>
							</div>
						))
					) : (
						<p className="empty-data">No files edited today</p>
					)}
				</div>
			)}
		</div>
	);
};
