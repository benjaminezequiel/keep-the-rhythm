# 性能优化方案：分区缓存

## 问题诊断

当前架构中，所有数据（历史 + 今日）都存储在单一的 `dailyActivity: DailyActivity[]` 数组中。每次用户编辑触发 `upsertActivity()` 时：

1. **数组引用变更** — Zustand 创建新数组引用，所有订阅 `dailyActivity` 的组件收到通知
2. **全量重算** — `useMemo` 依赖数组引用变化，重新执行全部 O(n) 计算
3. **连锁反应** — Slot、Heatmap、Entries 同时重渲染 + 重计算

```
用户输入 → debounce(2s) → upsertActivity()
    → 复制 dailyActivity 数组 (O(n) copy)
    → set({ dailyActivity: newArray })
        → Zustand 通知所有订阅者
            → Slot: getCurrentCount() O(n)
            → Heatmap: filter + 聚合 O(n)  
            → Entries: filter 取今日 O(n)
            → checkStreak: getCurrentCount() O(n)
```

**核心矛盾**：即使只是今日一个文件的字数变化，也触发了全部历史数据的重算。

### 场景分析

| 场景 | 数据变化 | 当前成本 | 理想成本 |
|------|---------|---------|---------|
| 打字（改今日1个文件） | 今日1条记录 | O(全量记录数) | O(k), k<10 |
| 切换文件（同日不同文件） | 今日1条记录 | O(全量记录数) | O(k), k<10 |
| 日切换 | 产生新的"今日" | O(全量记录数) | O(k) + 历史缓存重建 |
| 查看历史数据 | 无 | O(全量记录数) | O(1) 命中缓存 |

---

## 推荐方案：分区缓存（Partitioned Cache）

### 核心思想

**不修改 store 数据模型**，在模块级缓存中做物理分区，将今日数据和历史数据分开管理：

- **历史数据分区**：大部分时候走缓存（O(1)），只有历史数据变更时才全量重建
- **今日数据分区**：每次按键重建，但只有 k < 10 条记录
- **最终结果**：两个分区的合并操作，O(k)

### 设计原则

1. **不将派生状态存入 store** — 避免多结构同步的脆弱性
2. **两个独立版本号** — 今日变更和历史变更分别触发各自的缓存失效
3. **分区缓存** — 历史分区稳定，今日分区高频但数据量小
4. **最小侵入** — 保持数据模型和持久化逻辑不变

---

### 实现方案

#### 1. Store 层：双版本号

```typescript
// store.ts

interface KTRState {
  dailyActivity: DailyActivity[];   // 保持不变，仍是唯一真相
  today: string;
  todayVersion: number;             // 今日数据变更时 +1
  historicalVersion: number;        // 历史数据变更时 +1
  // ... 其他字段不变
}
```

各 mutation 中版本号的更新规则：

| Action | todayVersion | historicalVersion | 说明 |
|--------|-------------|-------------------|------|
| `upsertActivity` (今日数据) | +1 | 不变 | 打字场景，高频触发 |
| `upsertActivity` (历史数据) | 不变 | +1 | 编辑历史日期的记录 |
| `deleteActivity` (今日数据) | +1 | 不变 | 删除今日条目 |
| `deleteActivity` (历史数据) | 不变 | +1 | 删除历史条目 |
| `renameFilePath` | 不变 | +1 | 影响所有日期的路径引用 |
| `bulkSetDailyActivity` | +1 | +1 | 全量刷新（初始化/外部同步） |
| `hydrateFromPluginData` | +1 | +1 | 插件启动/外部设置变更 |
| `checkDayChange` | +1 | +1 | 日切换时，旧的今日数据变为历史 |

```typescript
// upsertActivity 示例
upsertActivity: (row) => {
  const cur = get();
  const idx = cur.dailyActivity.findIndex(...);
  const next = idx === -1
    ? [...cur.dailyActivity, row]
    : cur.dailyActivity.map((r, i) => (i === idx ? row : r));
  
  const isToday = row.date === cur.today;
  set({
    dailyActivity: next,
    currentActivity: isCurrent ? row : cur.currentActivity,
    todayVersion: isToday ? cur.todayVersion + 1 : cur.todayVersion,
    historicalVersion: !isToday ? cur.historicalVersion + 1 : cur.historicalVersion,
  });
  get().requestPersist();
}
```

**注意**：`checkDayChange` 时，旧的 `today` 数据变为历史数据，因此两个版本号都要 +1。

#### 2. 模块级分区缓存

```typescript
// src/utils/dailySummaryCache.ts

let cachedHistoricalMap: Record<string, number> | null = null;
let cachedHistoricalVersion = -1;
let cachedHistoricalToday: string | null = null;

let cachedTodayEntries: DailyActivity[] | null = null;
let cachedTodayVersion = -1;
let cachedTodayDate: string | null = null;

export function getDailySummaryMap(
  dailyActivity: DailyActivity[],
  today: string,
  todayVersion: number,
  historicalVersion: number,
): Record<string, number> {
  // 分区 1：历史数据（date < today）
  if (
    historicalVersion !== cachedHistoricalVersion ||
    cachedHistoricalToday !== today  // 日切换时也需重建
  ) {
    const historical = dailyActivity.filter((a) => a.date < today);
    cachedHistoricalMap = aggregateByDate(historical);
    cachedHistoricalVersion = historicalVersion;
    cachedHistoricalToday = today;
  }

  // 分区 2：今日数据（date === today）
  if (todayVersion !== cachedTodayVersion || cachedTodayDate !== today) {
    cachedTodayEntries = dailyActivity.filter((a) => a.date === today);
    cachedTodayVersion = todayVersion;
    cachedTodayDate = today;
  }

  // 合并：O(k)，k 通常 < 10
  const result = { ...cachedHistoricalMap };
  for (const entry of cachedTodayEntries!) {
    result[entry.date] = (result[entry.date] || 0) + entry.wordsAdded;
  }
  return result;
}

function aggregateByDate(entries: DailyActivity[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of entries) {
    map[entry.date] = (map[entry.date] || 0) + entry.wordsAdded;
  }
  return map;
}

/** 重置所有缓存（用于插件卸载） */
export function resetDailySummaryCache(): void {
  cachedHistoricalMap = null;
  cachedHistoricalVersion = -1;
  cachedHistoricalToday = null;
  cachedTodayEntries = null;
  cachedTodayVersion = -1;
  cachedTodayDate = null;
}
```

#### 3. Data Queries 层

```typescript
// src/core/dataQueries.ts

// 导出版本号 selector，供组件订阅
export const selectTodayVersion = (s: KTRState) => s.todayVersion;
export const selectHistoricalVersion = (s: KTRState) => s.historicalVersion;

// getCurrentCount 使用分区缓存
export function getCurrentCount(
  target: TargetCount,
  calc?: CalculationType,
): number {
  const { today, daysWithCompletedGoal, dailyActivity, todayVersion, historicalVersion } =
    useStore.getState();

  if (target === TargetCount.CURRENT_STREAK) { /* 不变 */ }
  if (target === TargetCount.CURRENT_DAY) {
    const map = getDailySummaryMap(dailyActivity, today, todayVersion, historicalVersion);
    return map[today] || 0;
  }
  if (target === TargetCount.LAST_DAY) { /* 使用今日缓存 + 昨日历史 */ }

  const range = getPeriodRange(target, today);
  if (!range) { /* 不变 */ }

  const map = getDailySummaryMap(dailyActivity, today, todayVersion, historicalVersion);
  const value = sumRangeFromMap(map, range.startDate, today);
  return calc === CalculationType.AVG
    ? Math.round(value / range.totalDays)
    : value;
}

// 从 map 中取日期范围的总和（O(days)，days ≤ 365）
function sumRangeFromMap(
  map: Record<string, number>,
  startDate: string,
  endDate: string,
): number {
  let sum = 0;
  const cursor = moment(startDate);
  while (cursor.format("YYYY-MM-DD") <= endDate) {
    const dateStr = cursor.format("YYYY-MM-DD");
    sum += map[dateStr] || 0;
    cursor.add(1, "days");
  }
  return sum;
}
```

#### 4. UI 层改造

**Slot.tsx**:
```typescript
import { shallow } from "zustand/shallow";
import { selectTodayVersion, selectHistoricalVersion } from "@/core/dataQueries";

// 订阅版本号 + today + 配置，不订阅全量数组
const today = useStore((s) => s.today);
const todayVersion = useStore(selectTodayVersion);
const historicalVersion = useStore(selectHistoricalVersion);
const daysWithCompletedGoal = useStore((s) => s.daysWithCompletedGoal);

// 使用 useMemo 包装，依赖版本号和配置
const value = useMemo(
  () => getCurrentCount(optionType, calcMode),
  [optionType, calcMode, today, todayVersion, historicalVersion, daysWithCompletedGoal]
);
```

**Entries.tsx**:
```typescript
import { shallow } from "zustand/shallow";

// 订阅 todayVersion 而非 dailyActivity
const today = useStore((s) => s.today);
const todayVersion = useStore((s) => s.todayVersion);

// 直接从缓存取今日条目
const entries = useMemo(() => {
  const { dailyActivity, todayVersion, historicalVersion } = useStore.getState();
  const allToday = getDailySummaryMap(dailyActivity, today, todayVersion, historicalVersion);
  // 实际上 Entries 需要的是条目列表而非汇总，需要单独的缓存函数
  return getTodayEntriesFromCache(dailyActivity, today, todayVersion);
}, [today, todayVersion, filters]);
```

**Heatmap.tsx**:
```typescript
import { shallow } from "zustand/shallow";

const today = useStore((s) => s.today);
const todayVersion = useStore((s) => s.todayVersion);
const historicalVersion = useStore((s) => s.historicalVersion);

const heatmapData = useMemo(() => {
  const { dailyActivity } = useStore.getState();
  
  if (query) {
    // CodeBlock 过滤场景：仍需全量数组
    return computeFilteredHeatmap(dailyActivity, query, ...);
  }
  
  // 无过滤场景：使用分区缓存
  return getDailySummaryMap(dailyActivity, today, todayVersion, historicalVersion);
}, [today, todayVersion, historicalVersion, query, weeksToShow, baseDate]);
```

---

### 性能对比

| 场景 | 当前方案 | 分区缓存方案 |
|------|---------|-------------|
| 打字（改今日1个文件） | O(n) 全量重算 | **O(k)** 合并，k<10 |
| 切换文件（同日不同文件） | O(n) 全量重算 | **O(k)** 合并，k<10 |
| 日切换 | O(n) 全量重算 | O(n_historical) 重建历史分区 + O(k) 今日分区 |
| 查看历史数据 | O(n) 全量重算 | **O(1)** 命中历史分区缓存 |
| Heatmap 渲染（无过滤） | O(n) 全量重算 | **O(1)** 命中缓存 |
| Heatmap 渲染（有过滤） | O(n) 过滤+聚合 | O(n) 过滤+聚合（不变） |

---

## 实施步骤

### Step 1：Store 层 — 添加双版本号
- 在 `store.ts` 的 `KTRState` 接口新增 `todayVersion: number` 和 `historicalVersion: number`
- 初始值均为 0
- 在以下 mutation action 中按规则递增：
  - `upsertActivity`: 按 `row.date === today` 判断
  - `deleteActivity`: 按 `date === today` 判断
  - `bulkSetDailyActivity`: 两者都 +1
  - `renameFilePath`: 仅 `historicalVersion` +1
  - `setCurrentActivity`: 不触发版本号变更
  - `checkDayChange`: 两者都 +1（旧今日数据变为历史）
- `hydrateFromPluginData`: 两者都 +1

### Step 2：创建模块级分区缓存
- 新建 `src/utils/dailySummaryCache.ts`
- 实现 `getDailySummaryMap()` 分区缓存函数
- 实现 `resetDailySummaryCache()` 清理函数
- 在 `main.ts` 的 `onunload` 中调用 `resetDailySummaryCache()`

### Step 3：改造 dataQueries.ts
- 导出 `selectTodayVersion` 和 `selectHistoricalVersion` selector
- `getCurrentCount()` 改用 `getDailySummaryMap()`
- 新增 `getTodayEntriesFromCache()` 供 Entries 组件使用

### Step 4：改造 Slot.tsx
- 订阅 `todayVersion` + `historicalVersion` 替代 `dailyActivity`
- 保持 `useMemo` 模式，依赖数组改为版本号

### Step 5：改造 Heatmap.tsx
- 无过滤场景使用分区缓存
- 有过滤场景仍使用全量数组

### Step 6：改造 Entries.tsx
- 订阅 `todayVersion` 替代 `dailyActivity`
- 使用 `getTodayEntriesFromCache()` 获取今日条目

### Step 7：验证与回归
- 打字时观察 React DevTools 渲染次数和计算耗时
- 验证 Streak 计算准确性
- 验证数据持久化完整性（保存/加载不变）
- 回归测试 CodeBlock 场景（ktr-heatmap、ktr-slots、ktr-entries）
- 测试日切换场景（手动改系统时间或模拟）

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 版本号不同步 | 缓存失效延迟或提前 | 在所有 mutation 路径中递增，版本号逻辑可单元测试 |
| 日切换时缓存不一致 | 历史分区和今日分区可能有短暂错误 | `checkDayChange` 时两个版本号同时 +1，强制重建 |
| CodeBlock 过滤性能 | 过滤场景仍需 O(n) | codeBlock 使用频率低，影响可接受；后续可考虑为常见过滤模式建索引 |
| 模块级缓存内存泄漏 | 长时间运行后缓存不释放 | 在 `onunload` 中重置缓存 |
| `today` 变更但缓存未失效 | 展示过期数据 | 缓存 key 包含 `today` 字符串，日切换时自然失效 |

---

## 文件变更清单

| 文件 | 变更类型 | 变更内容 |
|------|---------|---------|
| `src/core/store.ts` | 修改 | 新增 `todayVersion`、`historicalVersion` 状态；修改所有 mutation action 的版本号逻辑 |
| `src/utils/dailySummaryCache.ts` | **新建** | 分区缓存实现 |
| `src/core/dataQueries.ts` | 修改 | 新增版本号 selector；改造查询函数使用分区缓存 |
| `src/ui/components/Slot.tsx` | 修改 | 订阅版本号替代全量数组 |
| `src/ui/components/Heatmap.tsx` | 修改 | 无过滤场景使用分区缓存 |
| `src/ui/components/Entries.tsx` | 修改 | 使用今日缓存 |
| `src/main.ts` | 修改 | `onunload` 中重置缓存 |
