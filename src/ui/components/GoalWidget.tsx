import React, { useEffect, useRef, useState } from "react";

import { getCurrentCount } from "@/db/queries";
import { CalculationType, TargetCount, Unit } from "@/defs/types";
import { EVENTS, state } from "@/core/pluginState";
import { CONFETTI_COLORS } from "@/ui/confetti";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Longer than both the pulse/glow animation (1400ms) and the longest possible
// confetti piece (delay + duration, up to ~3.8s) so nothing gets cut off.
const CELEBRATION_DURATION = 4000;
const CONFETTI_COUNT = 36;

interface ConfettiPiece {
	id: number;
	left: number;
	color: string;
	delay: number;
	duration: number;
	drift: number;
	rotation: number;
}

function createConfetti(): ConfettiPiece[] {
	return Array.from({ length: CONFETTI_COUNT }, (_, id) => ({
		id,
		left: Math.random() * 100,
		color:
			CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
		delay: Math.random() * 0.3,
		duration: 2.9 + Math.random() * 0.6,
		drift: Math.random() * 70 - 35,
		rotation: Math.random() * 520 - 260,
	}));
}

export const GoalWidget = () => {
	const [value, setValue] = useState(0);
	const [goal, setGoal] = useState(
		state.plugin.data.settings.dailyWritingGoal,
	);
	const [isCelebrating, setIsCelebrating] = useState(false);
	const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);

	const celebrateTimeout = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const updateData = async () => {
		const v = await getCurrentCount(
			Unit.WORD,
			TargetCount.CURRENT_DAY,
			CalculationType.TOTAL,
		);
		setValue(v);
		setGoal(state.plugin.data.settings.dailyWritingGoal);
	};

	const celebrate = () => {
		if (celebrateTimeout.current) clearTimeout(celebrateTimeout.current);
		setIsCelebrating(false);
		setConfetti([]);
		// Force a reflow so the animation restarts even if it's already running
		requestAnimationFrame(() => {
			setIsCelebrating(true);
			setConfetti(createConfetti());
			celebrateTimeout.current = setTimeout(() => {
				setIsCelebrating(false);
				setConfetti([]);
			}, CELEBRATION_DURATION);
		});
	};

	useEffect(() => {
		state.off(EVENTS.REFRESH_EVERYTHING, updateData);
		state.on(EVENTS.REFRESH_EVERYTHING, updateData);

		state.off(EVENTS.DAILY_WRITING_GOAL_REACHED, celebrate);
		state.on(EVENTS.DAILY_WRITING_GOAL_REACHED, celebrate);

		updateData();

		return () => {
			state.off(EVENTS.REFRESH_EVERYTHING, updateData);
			state.off(EVENTS.DAILY_WRITING_GOAL_REACHED, celebrate);
			if (celebrateTimeout.current) clearTimeout(celebrateTimeout.current);
		};
	}, []);

	// Word count can dip below zero for a moment while edits are still being
	// processed (e.g. a large deletion). Floor it so the ring never wraps
	// around and shows a misleadingly full circle.
	const displayValue = Math.max(value, 0);
	const progress = goal > 0 ? Math.min(displayValue / goal, 1) : 0;
	const goalReached = goal > 0 && value >= goal;
	const dashOffset = CIRCUMFERENCE * (1 - progress);

	return (
		<div
			className={
				"goal-widget" +
				(goalReached ? " goal-widget--reached" : "") +
				(isCelebrating ? " goal-widget--celebrate" : "")
			}
		>
			{confetti.length > 0 && (
				<div className="goal-widget__confetti" aria-hidden="true">
					{confetti.map((piece) => (
						<span
							key={piece.id}
							className="goal-widget__confetti-piece"
							style={
								{
									"--left": `${piece.left}%`,
									"--piece-color": piece.color,
									"--delay": `${piece.delay}s`,
									"--duration": `${piece.duration}s`,
									"--drift": `${piece.drift}px`,
									"--rotation": `${piece.rotation}deg`,
								} as React.CSSProperties
							}
						/>
					))}
				</div>
			)}
			<div className="goal-widget__header">Goal</div>
			<div className="goal-widget__ring-wrapper">
				<svg
					className="goal-widget__ring"
					viewBox="0 0 120 120"
					aria-hidden="true"
				>
					<circle
						className="goal-widget__track"
						cx="60"
						cy="60"
						r={RADIUS}
					/>
					<circle
						className="goal-widget__fill"
						cx="60"
						cy="60"
						r={RADIUS}
						strokeDasharray={CIRCUMFERENCE}
						strokeDashoffset={dashOffset}
					/>
				</svg>
				<div className="goal-widget__center">
					<div className="goal-widget__label">
						{goalReached ? "Goal reached!" : "Already"}
					</div>
					<div className="goal-widget__value">
						{displayValue.toLocaleString()}
					</div>
					<div className="goal-widget__unit">words</div>
				</div>
			</div>
			<div className="goal-widget__caption">
				of at least {goal.toLocaleString()} words
			</div>
		</div>
	);
};
