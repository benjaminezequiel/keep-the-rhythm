import { getDateBasedOnIndex } from "@/utils/dateUtils";
import React from "react";
import { setIcon } from "obsidian";
import { useState, useEffect, useRef } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { getCurrentCount, getCurrentCountWithMode } from "@/db/queries";
import { CalculationType } from "@/defs/types";
import { Tooltip } from "./Tooltip";
import { getSlotLabel, weekdaysNames } from "../texts";
import { TargetCount, SlotConfig, Unit } from "@/defs/types";
import { EVENTS, state } from "@/core/pluginState";

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
	// TODO: should probably make something that stores data that's not from today so its only udpated on refresh everything!

	const [value, setValue] = useState<number | string>(0);
	const [unitType, setUnitType] = useState<Unit>(unit);
	const [optionType, setOptionType] = useState<TargetCount>(option);
	const [calcMode, setCalcType] = useState<CalculationType>(calc);
	const [progressValue, setProgressValue] = useState<number>(0);
	const [isLoading, setIsLoading] = useState<boolean>(false);

	const deleteButtonRef = useRef<HTMLButtonElement>(null);
	const unitButtonRef = useRef<HTMLButtonElement>(null);
	const typeButtonRef = useRef<HTMLButtonElement>(null);
	const calcButtonRef = useRef<HTMLButtonElement>(null);

	const TargetCounts = Object.values(TargetCount);
	const plugin = state.plugin;

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
		optionType !== TargetCount.WHOLE_VAULT &&
		optionType !== TargetCount.CURRENT_STREAK;
	// useEffect(() => {
	// }, [calcMode, optionType]);

	const toggleCalculation = () => {
		const newCalc =
			calcMode == CalculationType.TOTAL
				? CalculationType.AVG
				: CalculationType.TOTAL;

		if (plugin?.data?.settings) {
			plugin.data.settings.sidebarConfig.slots[index].calc = newCalc;
			plugin.quietSave();
		}

		setCalcType(newCalc);
	};

	const toggleUnit = () => {
		const newUnit: Unit = unitType === Unit.WORD ? Unit.CHAR : Unit.WORD;

		if (plugin?.data?.settings) {
			plugin.data.settings.sidebarConfig.slots[index].unit = newUnit;
			plugin.quietSave();
		}
		setUnitType(newUnit);
	};

	const toggleSlotType = () => {
		const currentIndex = TargetCounts.indexOf(optionType);
		const nextIndex = (currentIndex + 1) % TargetCounts.length;
		const newOption = TargetCounts[nextIndex];

		if (plugin && plugin.data && plugin.data.settings) {
			plugin.data.settings.sidebarConfig.slots[index].option = newOption;
			plugin.quietSave();
		}

		setOptionType(newOption);
	};

	const updateData = async () => {
		if (
			optionType == TargetCount.WHOLE_VAULT &&
			(plugin.data.stats?.wholeVaultWordCount === undefined ||
				plugin.data.stats?.wholeVaultCharCount === undefined)
		)
			setIsLoading(true);
		try {
			// const v = await getCurrentCount(unitType, optionType, calcMode);
			const v = await getCurrentCountWithMode(
				unitType,
				optionType,
				calcMode,
				plugin.data.settings.negativeWordCountMode
			);
			if (optionType === TargetCount.CURRENT_DAY) {
				const goal = state.plugin.data.settings.dailyWritingGoal;
				const newProgress = ((v as number) / goal) * 100;
				setProgressValue(Math.min(newProgress, 100));
			}
			setValue(v);
		} catch (error) {
			console.error(error);
		} finally {
			if (optionType == TargetCount.WHOLE_VAULT) setIsLoading(false);
		}
	};

	useEffect(() => {
		state.off(EVENTS.REFRESH_EVERYTHING, updateData);
		state.on(EVENTS.REFRESH_EVERYTHING, updateData);

		updateData();

		return () => {
			state.off(EVENTS.REFRESH_EVERYTHING, updateData);
		};
	}, [unitType, optionType, calcMode]);

	function isDayCompleted(dayIndex: number) {
		const date = getDateBasedOnIndex(dayIndex);
		const data = state.plugin.data.stats?.daysWithCompletedGoal;

		if (data && data.includes(date)) {
			return true;
		}
		return false;
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
			{isLoading ? (
				<div className="slot__data-loading">Loading...</div>
			) : (
				<div className="slot__data">
					<div className="slot__value">{value.toLocaleString()}</div>
					<div className="slot__unit">
						{unitSupportingText()}
						<span className="slot__unit-avg">
							{showCalcType && calcMode == "AVG" ? "/day" : ""}
						</span>
					</div>
				</div>
			)}
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
