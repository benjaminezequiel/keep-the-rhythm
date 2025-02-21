import React from "react";
import { Stats } from "../types";
// import { formatDate } from '../utils';

export const Overview = ({ data }: { data: Stats }) => {
	const today = new Date();
	const formatDate = (date: Date): string => {
		return (
			date.getFullYear() +
			"-" +
			String(date.getMonth() + 1).padStart(2, "0") +
			"-" +
			String(date.getDate()).padStart(2, "0")
		);
	};

	const todayStr = formatDate(today);

	const getWordCount = (startDate: Date, endDate: Date) => {
		let total = 0;
		const start = formatDate(startDate);
		const end = formatDate(endDate);

		Object.entries(data).forEach(([date, dayData]) => {
			if (date >= start && date <= end) {
				total += dayData.totalDelta;
			}
		});
		return total;
	};

	const getWeekStart = (date: Date): Date => {
		const result = new Date(date);
		const day = result.getDay();
		const diff = result.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
		result.setDate(diff);
		return result;
	};

	const todayCount = data[todayStr]?.totalDelta || 0;

	const weekStart = new Date(today);
	const daysSinceMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
	weekStart.setDate(today.getDate() - daysSinceMonday);

	const weekCount = getWordCount(weekStart, today);

	const yearStart = new Date(today.getFullYear(), 0, 1);
	const yearCount = getWordCount(yearStart, today);

	return (
		<div className="stats-overview">
			<div className="stats-grid">
				<div className="stat-card">
					<div className="stat-label">Today</div>
					<div className="stat-value">
						{todayCount.toLocaleString()}
						<span className="stat-unit"> words</span>
					</div>
				</div>
				<div className="stat-card">
					<div className="stat-label">This Week</div>
					<div className="stat-value">
						{weekCount.toLocaleString()}
						<span className="stat-unit"> words</span>
					</div>
				</div>
				<div className="stat-card">
					<div className="stat-label">This Year</div>
					<div className="stat-value">
						{yearCount.toLocaleString()}
						<span className="stat-unit"> words</span>
					</div>
				</div>
			</div>
		</div>
	);
};
