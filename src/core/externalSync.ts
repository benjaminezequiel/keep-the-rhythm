import { DEFAULT_SETTINGS, PluginData } from "@/defs/types";
import { DayActivityMap, DaysMap } from "@/defs/types";
import { useStore } from "./store";
import { decodeActivities } from "./statsCodec";
import KeepTheRhythm from "../main";
import { Notice } from "obsidian";

/**
 * Handle external changes to data.json (e.g. from 坚果云 sync, manual edits).
 *
 * Strategy:
 *   1. loadData() 把外部变更"冻结"在内存里 —— 之后任何写盘都不会丢它
 *   2. 行级合并 days:同 key (date, filePath) 比新增字数,大者赢
 *   3. 联动合并当天 baseline:当天行赢了谁的 added,就用谁的 baseline
 *      (days[today] 和 todayBaselines 是成对存在的,拆开合并会让本地
 *      下一次 editorCount - baseline 算错)
 *   4. 浅快查:合并结果与当前 store 一致则 no-op,跳过 version bump / persist
 *   5. 一次性 setState 替换数据
 *   6. requestPersist
 *
 * 不需要手动作废"当前打开文件":ensureActivityExists 的守卫直接由
 * days[today] 行 + baseline 是否存在推导,外部删除行 / baseline 后,
 * 下一次触碰自然重建。游标状态(如 getCurrentCount 的 query cursor)
 * 不受行删除影响,旧的会自然过期。
 */
export async function handleExternalDataChange(plugin: KeepTheRhythm) {
	try {
		// 1. 先读盘 —— 外部数据现在活在内存里了
		const newData = await plugin.loadData();
		if (!newData) return;

		const cur = useStore.getState();
		const today = cur.today;

		// 2. settings: 外部覆盖,并上 defaults 兜底
		const newSettings = { ...DEFAULT_SETTINGS, ...newData.settings };

		// 3. 解码外部 (含 legacy 迁移)
		const ext = decodeActivities(newData.stats, today);

		// 4. 行级合并 days —— 同 key 取新增字数大者,本地独有行丢弃
		//    (尊重外部删除)。今天的赢家是谁单独记录,用于联动 baseline。
		const mergedDays: DaysMap = {};
		const localWonToday: Record<string, boolean> = {};
		for (const [date, extDay] of Object.entries(ext.days)) {
			const localDay = cur.days[date];
			const mergedDay: DayActivityMap = {};
			for (const [filePath, extAdded] of Object.entries(extDay)) {
				const localAdded = localDay?.[filePath];
				const localWon = localAdded !== undefined && localAdded >= extAdded;
				mergedDay[filePath] = localWon ? localAdded : extAdded;
				if (date === today) localWonToday[filePath] = localWon;
			}
			mergedDays[date] = mergedDay;
		}

		// 5. 联动合并当天 baseline
		const mergedBaselines: DayActivityMap = {};
		for (const filePath of Object.keys(mergedDays[today] ?? {})) {
			let baseline: number | undefined;
			if (localWonToday[filePath]) {
				if (cur.todayBaselinesDay === today) {
					baseline = cur.todayBaselines[filePath];
				}
			} else if (ext.todayBaselinesDay === today) {
				baseline = ext.todayBaselines[filePath];
			}
			if (baseline !== undefined) {
				mergedBaselines[filePath] = baseline;
			}
		}
		const mergedBaselinesDay =
			Object.keys(mergedBaselines).length > 0 ? today : null;

		// 6. 浅快查:合并结果与当前 store 一致则直接返回
		if (
			isNoop(cur, newSettings, {
				days: mergedDays,
				todayBaselines: mergedBaselines,
				todayBaselinesDay: mergedBaselinesDay,
			})
		) {
			return;
		}

		// 7. 一次性 setState
		useStore.setState({
			settings: newSettings,
			days: mergedDays,
			todayBaselines: mergedBaselines,
			todayBaselinesDay: mergedBaselinesDay,
			today,
			todayVersion: cur.todayVersion + 1,
			historicalVersion: cur.historicalVersion + 1,
		});

		// 8. 写回磁盘
		useStore.getState().requestPersist();
	} catch (error) {
		console.error("Error in handleExternalDataChange:", error);
		new Notice("KTR: failed to sync external data.json changes.");
	}
}

interface Partitions {
	days: DaysMap;
	todayBaselines: DayActivityMap;
	todayBaselinesDay: string | null;
}

/** Shallow structural equality for the no-op fast path. */
function isNoop(
	cur: ReturnType<typeof useStore.getState>,
	newSettings: typeof cur.settings,
	merged: Partitions,
): boolean {
	if (!daysEqual(cur.days, merged.days)) return false;
	if (!dayMapsEqual(cur.todayBaselines, merged.todayBaselines)) return false;
	if (cur.todayBaselinesDay !== merged.todayBaselinesDay) return false;
	if (JSON.stringify(newSettings) !== JSON.stringify(cur.settings)) {
		return false;
	}
	return true;
}

function dayMapsEqual(a: DayActivityMap, b: DayActivityMap): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const k of aKeys) {
		if (a[k] !== b[k]) return false;
	}
	return true;
}

function daysEqual(a: DaysMap, b: DaysMap): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const date of aKeys) {
		if (!dayMapsEqual(a[date], b[date])) return false;
	}
	return true;
}