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
 *   - settings:       JSON equality (settings is small, the cost is
 *                     negligible compared to the dailyActivity sum).
 */
function isNoop(
	cur: ReturnType<typeof useStore.getState>,
	newSettings: typeof cur.settings,
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
 *   3. 浅快查:合并结果与当前 store 一致则 no-op,跳过 version bump / persist
 *   4. 一次性 setState 替换两块数据;selectCurrentActivity 自动从新数组里
 *      找到(或找不到)对应行
 *   5. 如果当前打开文件的行在外部被删了,清掉 currentFilePath,让下次
 *      ensureActivityExists 自然重建
 *   6. requestPersist
 */
export async function handleExternalDataChange(plugin: KeepTheRhythm) {
	try {
		// 1. 先读盘 —— 外部数据现在活在内存里了
		const newData = await plugin.loadData();
		if (!newData) return;

		const cur = useStore.getState();

		// 2. settings: 外部覆盖,并上 defaults 兜底
		const newSettings = { ...DEFAULT_SETTINGS, ...newData.settings };

		// 3. dailyActivity: 行级合并
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

		// 4. 浅快查:合并结果跟当前 store 一致就直接返回
		if (isNoop(cur, newSettings, mergedDaily)) {
			return;
		}

		// 5. 一次性 setState —— selectCurrentActivity 会在下次读取时
		//    自动从 mergedDaily 找对应行(找不到就返回 null)
		useStore.setState({
			settings: newSettings,
			dailyActivity: mergedDaily,
			today: cur.today,
			todayVersion: cur.todayVersion + 1,
			historicalVersion: cur.historicalVersion + 1,
		});

		// 6. 如果外部把当前打开文件的行删了,清掉 currentFilePath
		//    —— 否则 ensureActivityExists 会因 file.path === currentFilePath
		//    短路,不会重建今天的行
		if (cur.currentFilePath) {
			const hasRow = mergedDaily.some(
				(r) =>
					r.date === cur.today &&
					r.filePath === cur.currentFilePath,
			);
			if (!hasRow) {
				useStore.getState().setCurrentFilePath(null);
			}
		}

		// 7. 写回磁盘
		useStore.getState().requestPersist();
	} catch (error) {
		console.error("Error in handleExternalDataChange:", error);
		new Notice("KTR: failed to sync external data.json changes.");
	}
}
