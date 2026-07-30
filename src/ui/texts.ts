import { TargetCount } from "@/defs/types";

export const weekdaysNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const monthNames = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function getSlotLabel(option: TargetCount) {
	switch (option) {
		case TargetCount.CURRENT_FILE:
			return "This File";
		case TargetCount.CURRENT_DAY:
			return "Today";
		case TargetCount.CURRENT_WEEK:
			return "This Week";
		case TargetCount.CURRENT_MONTH:
			return "This Month";
		case TargetCount.CURRENT_YEAR:
			return "This Year";
		case TargetCount.LAST_DAY:
			return "Last 24 Hours";
		case TargetCount.LAST_WEEK:
			return "Last 7 Days";
		case TargetCount.LAST_MONTH:
			return "Last 30 Days";
		case TargetCount.LAST_YEAR:
			return "Last Year";
		case TargetCount.CURRENT_STREAK:
			return "Streak";
	}
}
