import * as RadixTooltip from "@radix-ui/react-tooltip";
import React from "react";

interface TooltipProps {
	content: React.ReactNode;
	children: React.ReactNode;
}

/**
 * Memoized tooltip.  Callers should pass stable `content` references
 * (e.g. via useMemo over the underlying primitives) so that consumers
 * like the 364 heatmap cells can skip re-render entirely on keystrokes
 * that don't touch them.  Radix's Root/Trigger/Portal subtree is
 * otherwise diffed on every parent render.
 */
export const Tooltip = React.memo(function Tooltip({
	content,
	children,
}: TooltipProps) {
	return (
		<RadixTooltip.Root>
			<RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
			<RadixTooltip.Portal>
				<RadixTooltip.Content
					className="tooltip-content"
					side="bottom"
					sideOffset={2}
					collisionPadding={8}
				>
					{content}
					<RadixTooltip.Arrow className="tooltip-arrow" />
				</RadixTooltip.Content>
			</RadixTooltip.Portal>
		</RadixTooltip.Root>
	);
});
