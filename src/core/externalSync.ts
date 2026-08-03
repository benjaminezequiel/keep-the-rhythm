import { DEFAULT_SETTINGS, DailyActivity } from "@/defs/types";
import { useStore } from "./store";
import KeepTheRhythm from "../main";
import { Notice } from "obsidian";

const keyOf = (r: { date: string; filePath: string }) =>
	`${r.date}|${r.filePath}`;

/**
 * Quick shallow no-op check: compare merged result against current store
 * state.  Hits the common case (external write that didn't actually
 * change anything, e.g. a touch from the sync client) and short-circuits
 * before we bump todayVersion / historicalVersion or schedule a persist.
 *
 *   - dailyActivity:  same length, same key set, same wordCountStart +
 *                     wordsAdded per row.
 *   - daysWithCompletedGoal: same length, same set.
 *   - settings:       JSON equality (settings is small, the cost is
 *                     negligible compared to the dailyActivity sum).
 */
function isNoop(
	cur: ReturnType<typeof useStore.getState>,
	newSettings: typeof cur.settings,
	newDays: string[],
	mergedDaily: DailyActivity[],
): boolean {
	if (mergedDaily.length !== cur.dailyActivity.length) return false;
	const curByKey = new Map(
		cur.dailyActivity.map((r) => [keyOf(r), r]),
	);
	for (const r of mergedDaily) {
		const c = curByKey.get(keyOf(r));
		if (!c) return false;
		if (c.wordCountStart !== r.wordCountStart) return false;
		if (c.wordsAdded !== r.wordsAdded) return false;
	}

	if (newDays.length !== cur.daysWithCompletedGoal.length) return false;
	const newDaysSet = new Set(newDays);
	for (const d of cur.daysWithCompletedGoal) {
		if (!newDaysSet.has(d)) return false;
	}

	if (JSON.stringify(newSettings) !== JSON.stringify(cur.settings)) {
		return false;
	}

	return true;
}

/**
 * Handle external changes to data.json (e.g. from 坚果云 sync, manual edits).
 *
 * Strategy:
 *   1. loadData() 把外部变更"冻结"在内存里 —— 之后任何写盘都不会丢它
 *   2. 行级合并 dailyActivity:同 key 比总字数,本地独有行直接丢弃
 *   3. settings / daysWithCompletedGoal 直接用外部版本覆盖
 *   4. 浅快查:合并结果与当前 store 一致则 no-op,跳过 version bump / persist
 *   5. 一次性 setState + 还原 currentActivity + requestPersist
 */
export async function handleExternalDataChange(plugin: KeepTheRhythm) {
	try {
		// 1. 先读盘 —— 外部数据现在活在内存里了
		const newData = await plugin.loadData();
		if (!newData) return;

		const cur = useStore.getState();

		// 2. settings: 外部覆盖,并上 defaults 兜底
		const newSettings = { ...DEFAULT_SETTINGS, ...newData.settings };

		// 3. daysWithCompletedGoal: 外部覆盖(尊重外部删除)
		const newDays = newData.stats?.daysWithCompletedGoal ?? [];

		// 4. dailyActivity: 行级合并
		//    同 key → 总字数大者赢
		//    仅外部有 → 拿外部
		//    仅本地有 → 直接丢弃(尊重外部删除)
		const externalDaily = newData.stats?.dailyActivity ?? [];
		const localDaily = cur.dailyActivity;

		const localByKey = new Map(localDaily.map((r) => [keyOf(r), r]));

		const mergedDaily: DailyActivity[] = [];
		for (const ext of externalDaily) {
			const key = keyOf(ext);
			const local = localByKey.get(key);
			if (local) {
				mergedDaily.push(
					ext.wordsAdded >= local.wordsAdded ? ext : local,
				);
			} else {
				mergedDaily.push(ext);
			}
			localByKey.delete(key);
		}
		// localByKey 中剩下的就是"本地独有"行,直接丢弃

		// 5. 浅快查:合并结果跟当前 store 一致就直接返回
		if (isNoop(cur, newSettings, newDays, mergedDaily)) {
			return;
		}

		// 6. 一次性 setState
		useStore.setState({
			settings: newSettings,
			daysWithCompletedGoal: newDays,
			dailyActivity: mergedDaily,
			today: cur.today,
			currentActivity: null,
			todayVersion: cur.todayVersion + 1,
			historicalVersion: cur.historicalVersion + 1,
		});

		// 7. 还原 currentActivity(它一定在 mergedDaily 里 —— 外部刚刚同步过)
		if (cur.currentActivity) {
			const match = mergedDaily.find(
				(r) =>
					r.date === cur.currentActivity!.date &&
					r.filePath === cur.currentActivity!.filePath,
			);
			if (match) useStore.getState().setCurrentActivity(match);
		}

		// 8. 写回磁盘
		useStore.getState().requestPersist();
	} catch (error) {
		console.error("Error in handleExternalDataChange:", error);
		new Notice("KTR: failed to sync external data.json changes.");
	}
}
