import React from "react";
import { useMemo } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { weekdaysNames, monthNames } from "../texts";
import { getDateForCell } from "@/utils/dateUtils";
import { formatDate } from "@/utils/dateUtils";
import { DailyActivity } from "@/defs/types";
import { HeatmapColorModes, HeatmapConfig } from "@/defs/types";
import { HeatmapCell } from "./HeatmapCell";
import { compileEvaluator } from "@/core/codeBlockQuery";
import { useStore } from "@/core/store";
import { selectTodayVersion, selectHistoricalVersion } from "@/core/dataQueries";
import { getDailySummaryMap } from "@/utils/dailySummaryCache";
import { moment as _moment } from "obsidian";
const moment = _moment as unknown as typeof _moment.default;

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
	const weeksToShow = heatmapConfig.numberOfWeeks || 52;
	const baseDate = heatmapConfig.startDate
		? new Date(heatmapConfig.startDate)
		: undefined;
	const baseDateKey = heatmapConfig.startDate ?? null;

	const today = useStore((s) => s.today);
	const todayVersion = useStore(selectTodayVersion);
	const historicalVersion = useStore(selectHistoricalVersion);
	const dailyActivity = useStore((s) => s.dailyActivity);

	const compiledEvaluator = useMemo(() => {
		if (!query) return null;
		try {
			return compileEvaluator(query);
		} catch (e) {
			console.error("Error compiling query:", e);
			return null;
		}
	}, [query]);

	const hasFilter =
		(query?.type === "BinaryExpression" &&
			(query?.operator === "starts_with" ||
				query?.operator === "STARTS_WITH")) ||
		compiledEvaluator;

	// Date set is shared by both branches; build once per weeksToShow/baseDate.
	const requiredDates = useMemo(() => {
		const set = new Set<string>();
		for (let week = 0; week < weeksToShow; week++) {
			for (let day = 0; day < 7; day++) {
				const date = getDateForCell(week, day, weeksToShow, baseDate);
				set.add(formatDate(date));
			}
		}
		return set;
	}, [weeksToShow, baseDateKey]);

	// No-filter path: depends ONLY on version numbers + grid shape.  The
	// underlying getDailySummaryMap cache is version-keyed, so a stable
	// dailyActivity reference is irrelevant here.  This is the hot path
	// for the sidebar heatmap (no codeBlock filter) and must not invalidate
	// on every keystroke.
	const cachedHeatmapData = useMemo(() => {
		const fullMap = getDailySummaryMap();
		const filteredMap: Record<string, number> = {};
		for (const date of requiredDates) {
			filteredMap[date] = fullMap[date] || 0;
		}
		return filteredMap;
	}, [today, todayVersion, historicalVersion, requiredDates]);

	// Filtered path: needs the full array because compiledEvaluator walks
	// every entry.  This still runs on every keystroke, but only when the
	// codeBlock actually has a filter — the sidebar is unaffected.
	const filteredHeatmapData = useMemo(() => {
		if (!hasFilter) return null;

		let results: DailyActivity[];

		if (
			query?.type === "BinaryExpression" &&
			(query?.operator === "starts_with" ||
				query?.operator === "STARTS_WITH")
		) {
			const value = query.right.value;
			if (typeof value === "string") {
				const prefix = value.startsWith("/")
					? value.substring(1)
					: value;
				results = dailyActivity.filter(
					(e) =>
						requiredDates.has(e.date) &&
						e.filePath.startsWith(prefix),
				);
			} else {
				results = [];
			}
		} else if (compiledEvaluator) {
			results = dailyActivity.filter(
				(e) =>
					requiredDates.has(e.date) && compiledEvaluator(e),
			);
		} else {
			results = dailyActivity.filter((e) =>
				requiredDates.has(e.date),
			);
		}

		const dateMap: Record<string, number> = {};
		for (const entry of results) {
			dateMap[entry.date] =
				(dateMap[entry.date] || 0) + entry.wordsAdded;
		}
		return dateMap;
	}, [
		dailyActivity,
		hasFilter,
		query,
		compiledEvaluator,
		requiredDates,
	]);

	const heatmapData = filteredHeatmapData ?? cachedHeatmapData;

	const getIntensityLevel = useMemo(
		() => buildIntensityResolver(heatmapConfig),
		[heatmapConfig],
	);

	const monthLabels = useMemo(() => {
		const labels: { month: string; week: number }[] = [];
		let lastMonth = -1;

		for (let week = 0; week < weeksToShow; week++) {
			const date = getDateForCell(week, 0, weeksToShow, baseDate);
			const m = moment(date);
			const month = m.month();
			const dayOfMonth = m.date();

			if (month !== lastMonth && dayOfMonth <= 7) {
				labels.push({ month: monthNames[month], week });
				lastMonth = month;
			}
		}

		return labels;
	}, [weeksToShow, baseDateKey]);

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
								{monthLabels.map(({ month, week }) => (
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
														intensity={getIntensityLevel(
															count,
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

const buildIntensityResolver = (
	heatmapConfig: HeatmapConfig,
): ((count: number) => number) => {
	if (
		!heatmapConfig ||
		!heatmapConfig.intensityStops ||
		!heatmapConfig.intensityMode
	) {
		return () => 0;
	}

	const { low, medium, high } = heatmapConfig.intensityStops;
	const mode = heatmapConfig.intensityMode;

	switch (mode) {
		case HeatmapColorModes.GRADUAL:
		case HeatmapColorModes.LIQUID: {
			if (high === low) {
				return (count) => (count >= high ? 100 : 0);
			}
			const span = high - low;
			return (count) => {
				if (count <= low) return 0;
				if (count >= high) return 100;
				return ((count - low) / span) * 100;
			};
		}

		case HeatmapColorModes.SOLID:
			return (count) => (count >= low ? 4 : 0);

		case HeatmapColorModes.STOPS: {
			const sorted = [low, medium, high].sort((a, b) => a - b);
			const [minThreshold, midThreshold, maxThreshold] = sorted;
			return (count) => {
				if (count <= 0) return 0;
				if (count < minThreshold) return 1;
				if (count < midThreshold) return 2;
				if (count < maxThreshold) return 3;
				return 4;
			};
		}

		default:
			return () => 0;
	}
};
