import { getDateBasedOnIndex } from "@/utils/dateUtils";
import React from "react";
import { setIcon } from "obsidian";
import { useState, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { getCurrentCount } from "@/db/queries";
import { CalculationType } from "@/defs/types";
import { Tooltip } from "./Tooltip";
import { getSlotLabel, weekdaysNames } from "../texts";
import { TargetCount, SlotConfig, Unit } from "@/defs/types";
import { useStore } from "@/core/store";

export const Slot = ({
	index,
	option,
	unit,
	calc,
	onDelete,
	isCodeBlock,
}: SlotConfig & {
	onDelete: (index: number) => void;
	isCodeBlock?: boolean;
}) => {
	const [unitType, setUnitType] = useState<Unit>(unit);
	const [optionType, setOptionType] = useState<TargetCount>(option);
	const [calcMode, setCalcType] = useState<CalculationType>(calc);

	const deleteButtonRef = useRef<HTMLButtonElement>(null);
	const unitButtonRef = useRef<HTMLButtonElement>(null);
	const typeButtonRef = useRef<HTMLButtonElement>(null);
	const calcButtonRef = useRef<HTMLButtonElement>(null);

	const TargetCounts = Object.values(TargetCount);

	// Reactive slices of the store the slot's value depends on.  Each
	// selector re-renders the component only when that slice changes,
	// replacing the old SETTINGS_CHANGED / DAY_CHANGED / HISTORY_DATA_CHANGED
	// event listeners.
	const today = useStore((s) => s.today);
	const currentActivity = useStore((s) => s.currentActivity);
	const daysWithCompletedGoal = useStore((s) => s.daysWithCompletedGoal);
	const dailyWritingGoal = useStore((s) => s.settings.dailyWritingGoal);
	const mutateSettings = useStore((s) => s.mutateSettings);

	// useLiveQuery replaces the manual updateData() + event listener dance.
	// It re-runs whenever:
	//   • the IndexedDB rows the query touches change (auto-tracked by Dexie)
	//   • any of the deps below change (optionType/calcMode toggles, today
	//     rollover, currentActivity word-delta updates, streak list changes)
	const value = useLiveQuery(
		() =>
			getCurrentCount(optionType, calcMode, {
				today,
				currentActivity,
				daysWithCompletedGoal,
			}),
		[optionType, calcMode, today, currentActivity, daysWithCompletedGoal],
		0,
	);

	const unitSupportingText = () => {
		if (optionType === TargetCount.CURRENT_STREAK) {
			return "days";
		} else {
			return unitType.toLowerCase() + "s";
		}
	};

	/** SETUP BUTTON ICONS USING OBSIDIAN UTILITY */
	if (calcButtonRef.current) {
		const icon = calcMode == "TOTAL" ? "chart-spline" : "sigma";
		setIcon(calcButtonRef.current, icon);
	}
	if (unitButtonRef.current) {
		setIcon(unitButtonRef.current, "case-sensitive");
	}
	if (typeButtonRef.current) {
		setIcon(typeButtonRef.current, "list");
	}
	if (deleteButtonRef.current) {
		setIcon(deleteButtonRef.current, "x");
	}

	if (calcButtonRef.current) {
		const icon = calcMode == "TOTAL" ? "chart-spline" : "sigma";
		setIcon(calcButtonRef.current, icon);
	}

	const showCalcType =
		optionType !== TargetCount.CURRENT_FILE &&
		optionType !== TargetCount.CURRENT_DAY &&
		optionType !== TargetCount.LAST_DAY &&
		optionType !== TargetCount.CURRENT_STREAK;

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
		setCalcType(newCalc);
	};

	const toggleUnit = () => {
		const newUnit: Unit = unitType === Unit.WORD ? Unit.CHAR : Unit.WORD;

		mutateSettings((draft) => {
			draft.sidebarConfig.slots[index].unit = newUnit;
		});
		setUnitType(newUnit);
	};

	const toggleSlotType = () => {
		const currentIndex = TargetCounts.indexOf(optionType);
		const nextIndex = (currentIndex + 1) % TargetCounts.length;
		const newOption = TargetCounts[nextIndex];

		mutateSettings((draft) => {
			draft.sidebarConfig.slots[index].option = newOption;
		});
		setOptionType(newOption);
	};

	const progressValue =
		optionType === TargetCount.CURRENT_DAY && dailyWritingGoal > 0
			? Math.min(((value ?? 0) / dailyWritingGoal) * 100, 100)
			: 0;

	function isDayCompleted(dayIndex: number) {
		const date = getDateBasedOnIndex(dayIndex);
		return daysWithCompletedGoal?.includes(date) ?? false;
	}

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

							<Tooltip content="Change Unit">
								<button
									className="KTR-min-button"
									ref={unitButtonRef}
									onClick={() => {
										toggleUnit();
									}}
								></button>
							</Tooltip>
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
				<div className="slot__value">
					{(value ?? 0).toLocaleString()}
				</div>
				<div className="slot__unit">
					{unitSupportingText()}
					<span className="slot__unit-avg">
						{showCalcType && calcMode == "AVG" ? "/day" : ""}
					</span>
				</div>
			</div>
			{optionType === TargetCount.CURRENT_DAY &&
				unitType !== Unit.CHAR && (
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
								(isDayCompleted(index) ? "completed" : "")
							}
						></div>
					))}
				</div>
			)}
		</div>
	);
};
