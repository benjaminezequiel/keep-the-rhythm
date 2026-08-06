import { Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import React from "react";
import { CalculationType, SlotConfig, TargetCount } from "@/defs/types";
import { Slot } from "./Slot";
import { useStore } from "@/core/store";
import { useRef, useCallback, useMemo } from "react";
import { TransitionGroup, CSSTransition } from "react-transition-group";

interface SlotWrapperProps {
  slots?: SlotConfig[];
  isCodeBlock?: boolean;
}

export const SlotWrapper = ({ slots: slotsProp, isCodeBlock }: SlotWrapperProps) => {
  const storeSlots = useStore((s) => s.settings.sidebarConfig.slots);
  const mutateSettings = useStore((s) => s.mutateSettings);
  const effectiveSlots = isCodeBlock ? slotsProp : storeSlots;

  const uuidMapRef = useRef<Map<number, string>>(new Map());
  const nodeRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>(
    {},
  );

  const slotsWithUuid = useMemo(() => {
    const next = (effectiveSlots || []).map((slot) => {
      let uuid = uuidMapRef.current.get(slot.index);
      if (!uuid) {
        uuid = uuidv4();
        uuidMapRef.current.set(slot.index, uuid);
      }
      return { ...slot, uuid };
    });
    const liveUuids = new Set(next.map((s) => s.uuid));
    for (const uuid of uuidMapRef.current.values()) {
      if (!liveUuids.has(uuid)) {
        delete nodeRefs.current[uuid];
      }
    }
    for (const index of Array.from(uuidMapRef.current.keys())) {
      if (index >= next.length) {
        uuidMapRef.current.delete(index);
      }
    }
    return next;
  }, [effectiveSlots]);

  const handleDeleteClick = useCallback(
    (index: number) => {
      mutateSettings((draft) => {
        const newSlots = draft.sidebarConfig.slots.filter(
          (_, i) => i !== index,
        );
        newSlots.forEach((slot, i) => {
          slot.index = i;
        });
        draft.sidebarConfig.slots = newSlots;
      });
    },
    [mutateSettings],
  );

  const handleAddClick = useCallback(() => {
    if (slotsWithUuid && slotsWithUuid.length >= 10) {
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
  }, [mutateSettings, slotsWithUuid, effectiveSlots]);

  const getNodeRef = useCallback((uuid: string) => {
    if (!nodeRefs.current[uuid]) {
      nodeRefs.current[uuid] = React.createRef<HTMLDivElement>();
    }
    return nodeRefs.current[uuid];
  }, []);

  return (
    <div className="slot__section">
      <TransitionGroup className="slot__list">
        {slotsWithUuid?.map((slot, i) => {
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
            slotsWithUuid && slotsWithUuid.length >= 10 ? true : false
          }
        >
          + ADD NEW SLOT
        </button>
      )}
    </div>
  );
};
