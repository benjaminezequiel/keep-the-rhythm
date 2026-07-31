import React from "react";
import { useMemo } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { weekdaysNames, monthNames } from "../texts";
import { getDateForCell } from "@/utils/utils";
import { formatDate } from "@/utils/dateUtils";
import { DailyActivity } from "@/defs/types";
import { HeatmapColorModes, HeatmapConfig } from "@/defs/types";
import { HeatmapCell } from "./HeatmapCell";
import { compileEvaluator } from "@/core/codeBlockQuery";
import { useStore } from "@/core/store";

interface HeatmapProps {
	heatmapConfig: HeatmapConfig;
	query?: any;
	isCodeBlock?: boolean;
}

export const Heatmap = ({
	heatmapConfig,
	query,
	isCodeBlock,
}: HeatmapProps) => {
	let startDate: Date | null = null;
	let endDate: Date | null = null;
	const weeksToShow = heatmapConfig.numberOfWeeks || 52;
	const baseDate = heatmapConfig.startDate
		? new Date(heatmapConfig.startDate)
		: undefined;

	// Subscribe to the in-memory dailyActivity slice; memoize the heatmap
	// aggregation on it.  Mirrors the previous useLiveQuery behaviour
	// (re-runs when underlying rows change) but synchronously.
	const dailyActivity = useStore((s) => s.dailyActivity);

	const heatmapData = useMemo(() => {
		const requiredDates = new Set<string>();

		for (let week = 0; week < weeksToShow; week++) {
			for (let day = 0; day < 7; day++) {
				const date = getDateForCell(week, day, weeksToShow, baseDate);

				requiredDates.add(formatDate(date));

				if (!startDate || date < startDate) startDate = date;
				if (!endDate || date > endDate) endDate = date;
			}
		}

		let results: DailyActivity[];
		let filterFn: ((entry: DailyActivity) => boolean) | null = null;
		if (query) {
			try {
				filterFn = compileEvaluator(query);
			} catch (e) {
				console.error("Error compiling query:", e);
			}
		}

		if (
			query?.type == "BinaryExpression" &&
			query?.operator === "starts_with"
		) {
			let value = query.right.value;
			if (typeof value === "string") {
				value = value.startsWith("/") ? value.substring(1) : value;
				const startStr = startDate ? formatDate(startDate) : "";
				const endStr = endDate ? formatDate(endDate) : "";
				results = dailyActivity.filter(
					(e) =>
						e.filePath.startsWith(value) &&
						e.date >= startStr &&
						e.date <= endStr,
				);
			} else {
				results = [];
			}
		} else if (query && filterFn) {
			results = dailyActivity.filter(
				(e) => requiredDates.has(e.date) && filterFn!(e),
			);
		} else {
			results = dailyActivity.filter((e) => requiredDates.has(e.date));
		}

		const dateMap: Record<string, number> = {};

		for (const entry of results) {
			const entryValue = entry.wordsAdded;
			const valueUntilNow = dateMap[entry.date] || 0;
			dateMap[entry.date] = valueUntilNow + entryValue;
		}

		return dateMap;
	}, [dailyActivity, query, weeksToShow, baseDate]);

	const getMonthLabels = () => {
		const labels = [];
		let lastMonth = -1;

		for (let week = 0; week < weeksToShow; week++) {
			const date = getDateForCell(week, 0, weeksToShow, baseDate);

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

	const wrapperClasses = `
		heatmap-wrapper 
		${heatmapConfig.hideWeekdayLabels ? "hide-weekday-labels" : ""}
		${heatmapConfig.hideMonthLabels ? "hide-month-labels" : ""}
		${heatmapConfig.alignLeft ? "align-left" : ""}
		${isCodeBlock ? "is-code-block-heatmap" : ""}
	`;

	return (
		<RadixTooltip.Provider
			delayDuration={0}
			skipDelayDuration={1000}
			disableHoverableContent
		>
			{heatmapData && (
				<div className={wrapperClasses}>
					{!heatmapConfig.hideWeekdayLabels && (
						<div className="week-day-labels">
							{weekdaysNames.map((day) => (
								<div key={day} className="week-day-label">
									{day}
								</div>
							))}
						</div>
					)}
					<div className="heatmap-content">
						{!heatmapConfig.hideMonthLabels && (
							<div
								className="month-labels"
								style={{
									gridTemplateColumns: `repeat(${weeksToShow}, 10px)`,
								}}
							>
								{getMonthLabels().map(({ month, week }) => (
									<div
										key={`${month}-${week}`}
										className="month-label"
										style={{ gridColumn: week }}
									>
										{month}
									</div>
								))}
							</div>
						)}
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
												const date = getDateForCell(
													weekIndex,
													dayIndex,
													weeksToShow,
													baseDate,
												);
												const dateStr =
													formatDate(date);
												const count =
													heatmapData[dateStr] ?? 0;
												return (
													<HeatmapCell
														key={dateStr}
														count={count}
														date={dateStr}
														squared={
															!heatmapConfig.roundCells
														}
														intensity={getCellIntensityLevel(
															count,
															heatmapConfig,
														)}
														mode={
															heatmapConfig.intensityMode
														}
													/>
												);
											})}
									</div>
								))}
						</div>
					</div>
				</div>
			)}
		</RadixTooltip.Provider>
	);
};

const getCellIntensityLevel = (
	count: number,
	heatmapConfig: HeatmapConfig,
): number => {
	if (
		!heatmapConfig ||
		!heatmapConfig.intensityStops ||
		!heatmapConfig.intensityMode
	) {
		return 0;
	}

	const { low, medium, high } = heatmapConfig.intensityStops;

	switch (heatmapConfig.intensityMode) {
		case HeatmapColorModes.GRADUAL:
		case HeatmapColorModes.LIQUID:
			if (count <= low) return 0;
			if (count >= high) return 100;

			return ((count - low) / (high - low)) * 100;

		case HeatmapColorModes.SOLID:
			return count >= low ? 4 : 0;

		case HeatmapColorModes.STOPS:
			// Ensure thresholds are properly ordered
			const sortedThresholds = [low, medium, high].sort((a, b) => a - b);
			const [minThreshold, midThreshold, maxThreshold] = sortedThresholds;

			if (count <= 0) return 0;
			if (count < minThreshold) return 1;
			if (count < midThreshold) return 2;
			if (count < maxThreshold) return 3;
			return 4;
		default:
			return 0;
	}
};
