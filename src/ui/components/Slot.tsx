import { getCurrentWeekDates } from "@/utils/dateUtils";
import React from "react";
import { setIcon } from "obsidian";
import { useRef, useMemo, useEffect } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { getCurrentCount, selectTodayVersion, selectHistoricalVersion } from "@/core/dataQueries";
import { getDailySummaryMap } from "@/utils/dailySummaryCache";
import { CalculationType } from "@/defs/types";
import { Tooltip } from "./Tooltip";
import { getSlotLabel, weekdaysNames } from "../texts";
import { TargetCount, SlotConfig } from "@/defs/types";
import { useStore } from "@/core/store";

const TARGET_COUNTS = Object.values(TargetCount);

export const Slot = React.memo(function Slot({
	index,
	option,
	calc,
	onDelete,
	isCodeBlock,
}: SlotConfig & {
	onDelete: (index: number) => void;
	isCodeBlock?: boolean;
}) {
	// No local mirror: read directly from props.  The previous useState
	// mirror was redundant (every toggle already called setOptionType /
	// setCalcType) and would silently drift out of sync if the store was
	// mutated externally (e.g. by another codeBlock).
	const optionType = option;
	const calcMode = calc;

	const deleteButtonRef = useRef<HTMLButtonElement>(null);
	const typeButtonRef = useRef<HTMLButtonElement>(null);
	const calcButtonRef = useRef<HTMLButtonElement>(null);

	// Reactive slices of the store the slot's value depends on.  Each
	// selector re-renders the component only when that slice changes,
	// replacing the old SETTINGS_CHANGED / DAY_CHANGED / HISTORY_DATA_CHANGED
	// event listeners.
	const todayVersion = useStore(selectTodayVersion);
	const historicalVersion = useStore(selectHistoricalVersion);
	const dailyWritingGoal = useStore((s) => s.settings.dailyWritingGoal);
	const mutateSettings = useStore((s) => s.mutateSettings);

	// useLiveQuery is gone — getCurrentCount reads useStore.getState()
	// synchronously, so we just memoize on the slices the count depends on.
	// Using version numbers instead of the dailyActivity array reference
	// avoids unnecessary recomputation when only unrelated entries change.
	const value = useMemo(
		() => getCurrentCount(optionType, calcMode),
		[optionType, calcMode, todayVersion, historicalVersion, dailyWritingGoal],
	);

	const unitText = () => {
		if (optionType === TargetCount.CURRENT_STREAK) {
			return "days";
		} else {
			return "words";
		}
	};

	const showCalcType =
		optionType !== TargetCount.CURRENT_DAY &&
		optionType !== TargetCount.LAST_DAY &&
		optionType !== TargetCount.CURRENT_STREAK;

	useEffect(() => {
		if (calcButtonRef.current) {
			const icon = calcMode === "TOTAL" ? "chart-spline" : "sigma";
			setIcon(calcButtonRef.current, icon);
		}
	}, [calcMode, showCalcType]);

	useEffect(() => {
		if (typeButtonRef.current) {
			setIcon(typeButtonRef.current, "list");
		}
		if (deleteButtonRef.current) {
			setIcon(deleteButtonRef.current, "x");
		}
	}, []);

	const toggleCalculation = () => {
		const newCalc =
			calcMode == CalculationType.TOTAL
				? CalculationType.AVG
				: CalculationType.TOTAL;

		// Persist the new calc mode into settings (mutateSettings syncs
		// the store + saves to data.json, replacing plugin.quietSave()).
		mutateSettings((draft) => {
			draft.sidebarConfig.slots[index].calc = newCalc;
		});
	};

	const toggleSlotType = () => {
		const currentIndex = TARGET_COUNTS.indexOf(optionType);
		const nextIndex = (currentIndex + 1) % TARGET_COUNTS.length;
		const newOption = TARGET_COUNTS[nextIndex];

		mutateSettings((draft) => {
			draft.sidebarConfig.slots[index].option = newOption;
		});
	};

	const progressValue =
		optionType === TargetCount.CURRENT_DAY && dailyWritingGoal > 0
			? Math.min(((value ?? 0) / dailyWritingGoal) * 100, 100)
			: 0;

	// Memoize the 7-day completion states for CURRENT_WEEK view.
	// Computes getDailySummaryMap() once (not 7×) and caches the
	// week's date lookups. Recomputes only when the date or relevant
	// data versions change.
	const weekDayCompletedStates = useMemo<boolean[]>(() => {
		if (optionType !== TargetCount.CURRENT_WEEK) return [];
		const map = getDailySummaryMap();
		const weekDates = getCurrentWeekDates();
		return weekDates.map((date) => (map[date] ?? 0) >= dailyWritingGoal);
	}, [optionType, todayVersion, historicalVersion, dailyWritingGoal]);

	return (
		<div className="slot">
			<div id="customID" className="slot__header">
				<div className="slot__label">{getSlotLabel(optionType)}</div>
				{!isCodeBlock && (
					<div className="slot__buttons">
						<RadixTooltip.Provider delayDuration={200}>
							{showCalcType && (
								<Tooltip
									content={
										calcMode == "TOTAL"
											? "Show daily average"
											: "Show total"
									}
								>
									<button
										className="KTR-min-button"
										ref={calcButtonRef}
										onClick={() => {
											toggleCalculation();
										}}
									></button>
								</Tooltip>
							)}

							<Tooltip content="Change Type">
								<button
									className="KTR-min-button"
									ref={typeButtonRef}
									onClick={() => {
										toggleSlotType();
									}}
								></button>
							</Tooltip>
							<Tooltip content="Delete">
								<button
									className="KTR-min-button"
									ref={deleteButtonRef}
									onClick={() => {
										onDelete(index);
									}}
								></button>
							</Tooltip>
						</RadixTooltip.Provider>
					</div>
				)}
			</div>
			<div className="slot__data">
				<div className="slot__value">{value.toLocaleString()}</div>
				<div className="slot__unit">
					{unitText()}
					<span className="slot__unit-avg">
						{showCalcType && calcMode == "AVG" ? "/day" : ""}
					</span>
				</div>
			</div>
			{optionType === TargetCount.CURRENT_DAY && (
				<div className="today-progress-bar">
					<div
						className="progress"
						style={{
							width: progressValue + "%",
						}}
					></div>
				</div>
			)}
			{optionType === TargetCount.CURRENT_WEEK && (
				<div className="KTR-week-progress">
					{weekdaysNames.map((_, index) => (
						<div
							key={index}
							className={
								"KTR-dot " +
								(weekDayCompletedStates[index] ? "completed" : "")
							}
						></div>
					))}
				</div>
			)}
		</div>
	);
});
