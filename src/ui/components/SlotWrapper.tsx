import { Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import React from "react";
import {
	CalculationType,
	DirectoryFilter,
	SlotConfig,
	TargetCount,
	Unit,
} from "@/defs/types";
import { Slot } from "./Slot";
import { state } from "@/core/pluginState";
import { useEffect, useState, useRef } from "react";
import { TransitionGroup, CSSTransition } from "react-transition-group";

interface SlotWrapperProps {
	slots: SlotConfig[] | undefined;
	isCodeBlock?: boolean;
	directoryFilter?: DirectoryFilter;
}

export const SlotWrapper = ({
	slots,
	isCodeBlock,
	directoryFilter,
}: SlotWrapperProps) => {
	const [slotsState, setSlotsState] = useState<
		(SlotConfig & { uuid?: string })[] | undefined
	>(() => slots?.map((slot) => ({ ...slot, uuid: uuidv4() })));

	// Create refs for each slot to avoid findDOMNode warning
	const nodeRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>(
		{},
	);

	const updateSlots = () => {
		const currentSettings = state.plugin.data.settings.sidebarConfig.slots;
		const updatedSlots = currentSettings.map((slot) => {
			const existingSlot = slotsState?.find(
				(s) => s.index === slot.index,
			);
			return { ...slot, uuid: existingSlot?.uuid || uuidv4() };
		});

		setSlotsState(updatedSlots);
	};

	useEffect(() => {
		if (!isCodeBlock) {
			updateSlots();
		}
	}, []);

	const handleDeleteClick = (index: number) => {
		const newSlots = state.plugin.data.settings.sidebarConfig.slots.filter(
			(_, i) => i !== index,
		);

		// Update indexes after filtering
		newSlots.forEach((slot, i) => {
			slot.index = i;
		});

		if (state.plugin && state.plugin.data && state.plugin.data.settings) {
			state.plugin.data.settings.sidebarConfig.slots = newSlots;
		}

		// Call quietSave to persist changes
		state.plugin.quietSave();

		// Fix: Filter by uuid instead of index to maintain proper transition
		setSlotsState((prevSlots) => {
			if (!prevSlots) return prevSlots;
			const slotToDelete = prevSlots[index];
			return prevSlots.filter((slot) => slot.uuid !== slotToDelete.uuid);
		});
	};

	const handleAddClick = () => {
		if (slotsState && slotsState?.length >= 10) {
			new Notice("Maximum of 10 slots per view! (at least for now)");
			return;
		}
		const newSlot: SlotConfig = {
			index: state.plugin.data.settings.sidebarConfig.slots.length,
			option: TargetCount.CURRENT_FILE,
			unit: Unit.WORD,
			calc: CalculationType.TOTAL,
		};

		const updatedSlots = [
			...state.plugin.data.settings.sidebarConfig.slots,
			newSlot,
		];

		if (state.plugin && state.plugin.data && state.plugin.data.settings) {
			state.plugin.data.settings.sidebarConfig.slots = updatedSlots;
		}

		// Call quietSave to persist changes
		state.plugin.quietSave();

		// Update state with new UUID for the new slot
		setSlotsState([...(slotsState || []), { ...newSlot, uuid: uuidv4() }]);
	};

	// Create or get ref for each slot
	const getNodeRef = (uuid: string) => {
		if (!nodeRefs.current[uuid]) {
			nodeRefs.current[uuid] = React.createRef<HTMLDivElement>();
		}
		return nodeRefs.current[uuid];
	};

	return (
		<div className="slot__section">
			<TransitionGroup className="slot__list">
				{slotsState?.map((slot, i) => {
					const nodeRef = getNodeRef(slot.uuid!);
					return (
						<CSSTransition
							key={slot.uuid}
							timeout={500}
							classNames="slot-fade"
							unmountOnExit
							nodeRef={nodeRef}
						>
							<div ref={nodeRef}>
								<Slot
									index={i}
									option={slot.option}
									unit={slot.unit}
									calc={slot.calc}
									onDelete={handleDeleteClick}
									isCodeBlock={isCodeBlock}
									directoryFilter={directoryFilter}
								/>
							</div>
						</CSSTransition>
					);
				})}
			</TransitionGroup>
			{!isCodeBlock && (
				<button
					className="KTR-add-slot-button"
					onClick={handleAddClick}
					disabled={
						slotsState && slotsState?.length >= 10 ? true : false
					}
				>
					+ ADD NEW SLOT
				</button>
			)}
		</div>
	);
};
