import { Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import React from "react";
import { CalculationType, SlotConfig, TargetCount } from "@/defs/types";
import { Slot } from "./Slot";
import { useStore } from "@/core/store";
import { useState, useRef, useEffect } from "react";
import { TransitionGroup, CSSTransition } from "react-transition-group";

interface SlotWrapperProps {
  slots?: SlotConfig[];
  isCodeBlock?: boolean;
}

export const SlotWrapper = ({ slots: slotsProp, isCodeBlock }: SlotWrapperProps) => {
  // codeBlock mode uses the prop; sidebar mode reads from the store so
  // mutations via mutateSettings are reflected automatically.
  const storeSlots = useStore((s) => s.settings.sidebarConfig.slots);
  const mutateSettings = useStore((s) => s.mutateSettings);
  const effectiveSlots = isCodeBlock ? slotsProp : storeSlots;

  const [slotsState, setSlotsState] = useState<
    (SlotConfig & { uuid?: string })[] | undefined
  >(() => effectiveSlots?.map((slot) => ({ ...slot, uuid: uuidv4() })));

  // Create refs for each slot to avoid findDOMNode warning
  const nodeRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>(
    {},
  );

  // When the store-backed slots change (settings mutated elsewhere), sync
  // local state while preserving uuid stability for transition animations.
  useEffect(() => {
    if (isCodeBlock) return;
    setSlotsState((prev) =>
      (effectiveSlots || []).map((slot) => ({
        ...slot,
        uuid: prev?.find((s) => s.index === slot.index)?.uuid || uuidv4(),
      })),
    );
  }, [effectiveSlots, isCodeBlock]);

  const handleDeleteClick = (index: number) => {
    mutateSettings((draft) => {
      const newSlots = draft.sidebarConfig.slots.filter(
        (_, i) => i !== index,
      );
      // Re-index so slots remain contiguous
      newSlots.forEach((slot, i) => {
        slot.index = i;
      });
      draft.sidebarConfig.slots = newSlots;
    });
    // store update propagates to effectiveSlots → useEffect syncs slotsState
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
      index: effectiveSlots?.length ?? 0,
      option: TargetCount.CURRENT_DAY,
      calc: CalculationType.TOTAL,
    };

    mutateSettings((draft) => {
      draft.sidebarConfig.slots.push(newSlot);
    });

    // Optimistic local update with uuid for the transition
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
                  calc={slot.calc}
                  onDelete={handleDeleteClick}
                  isCodeBlock={isCodeBlock}
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
