import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "../components/ui/tooltip";

import React from "react";
import { WordCountData, IntensityConfig, ColorConfig } from "../types";
import { Overview } from "./Overview";
import { relative } from "path";

const formatDate = (date: Date): string => {
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return localDate.toISOString().split('T')[0];
};

interface HeatmapProps {
  data: WordCountData;
  intensityLevels: IntensityConfig;
  showOverview?: boolean;
}

interface HeatmapCellProps {
  date: string;
  count: number;
  intensityLevels: IntensityConfig;
}

const HeatmapCell = ({
  date,
  count,
  intensityLevels,
}: HeatmapCellProps) => {
  const getIntensityLevel = (count: number): number => {
    const { low, medium, high } = intensityLevels;
    if (count <= 0) return 0;
    if (count < low) return 1;
    if (count < medium) return 2;
    if (count < high) return 3;
    return 4;
  };
  

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`heatmap-square level-${getIntensityLevel(count)}`} />
      </TooltipTrigger>
      <TooltipContent className="custom-tooltip">
        <div className="tooltip-date">
		  {formatDate(new Date(date))}
        </div>
        <div className="tooltip-wordCount">+{count} words</div>
      </TooltipContent>
    </Tooltip>
  );
};

export const Heatmap = ({
  data,
  intensityLevels,
  showOverview = true,
}: HeatmapProps) => {
  const today = new Date();
  const weeksToShow = 52;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthNames = [
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

  const getDayIndex = (dayIndex: number): number => {
	return dayIndex === 0 ? 6 : dayIndex - 1
  }

  const getDateForCell = (weekIndex: number, dayIndex: number): Date => {
    const date = new Date(today);
	const todayDayIndex = getDayIndex(date.getDay());
	const todayWeekIndex = weeksToShow - 1;

    const daysOffset = (weekIndex - todayWeekIndex) * 7  + (dayIndex - todayDayIndex);      

    date.setDate(date.getDate() + daysOffset);
    return date;
  };

  const getMonthLabels = () => {
    const labels = [];
    let lastMonth = -1;

    for (let week = 0; week < weeksToShow; week++) {
        const date = getDateForCell(week, 0);
        // Get local date
        const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
        const month = localDate.getMonth();
        const dayOfMonth = localDate.getDate();

      if (month !== lastMonth && dayOfMonth <= 7) {
        labels.push({
          month: monthNames[month],
          week: week,
        });
        lastMonth = month;
      }
    }
    return labels;
  };

  return (
    <div className="component-wrapper">
      {showOverview && <Overview data={data} />}
      <TooltipProvider>
        <div className="heatmap-wrapper">
          <div className="heatmap-container">
            <div className="week-day-labels">
              {days.map((day) => (
                <div key={day} className="week-day-label">
                  {day}
                </div>
              ))}
            </div>

            <div className="heatmap-content">
              <div className="month-labels">
                {getMonthLabels().map(({ month, week }) => (
                  <div
                    key={`${month}-${week}`}
                    className="month-label"
                    style={{ gridColumn: week + 1 }}
                  >
                    {month}
                  </div>
                ))}
              </div>
			  <div className="heatmap-new-grid">
				{Array(weeksToShow)
					.fill(null)
					.map((_, weekIndex) => (
						<div key={weekIndex} className="heatmap-column">
							{Array(7)
								.fill(null)
								.map((_, dayIndex) => {
									const date = getDateForCell(weekIndex, dayIndex);
									const dateStr = formatDate(date);
									const dayData = data.dailyCounts[dateStr];
									let count = 0;
									if (dayData && dayData.totalDelta) {
										count = dayData?.totalDelta;
									}
		  
									return (
									  <HeatmapCell
										key={dayIndex}
										date={dateStr}
										count={count}
										intensityLevels={intensityLevels}
									  />
									);
								})
							}
						</div>
					))
				}
			  </div>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
};
