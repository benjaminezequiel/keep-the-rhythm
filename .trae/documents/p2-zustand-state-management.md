# P2: 引入 Zustand 替换手写 EventEmitter

## Context

P0/P1 把 `REFRESH_EVERYTHING` 拆成了 5 个细粒度事件，但本质仍是手写 EventEmitter + `requestAnimationFrame` 异步派发。每个组件手动 `state.on/off` + `setState` 重查 DB，导致：
- 组件代码充斥事件监听样板（Slot 监听 4 个事件、Entries 监听 3 个）
- DB 数据本可用 Dexie 的 `useLiveQuery` 响应式订阅（Heatmap 已这么做），但 Slot/Entries 仍走"手动查 + 事件重查"模式
- `settings` 变化靠事件广播，无法用 selector 精确订阅，SidebarView 每次 settings 变都全量 setState

引入 Zustand 后：`today` / `currentActivity` / `settings` / `daysWithCompletedGoal` 放 store，组件用 `useStore(selector)` 精确订阅；DB 数据用 `useLiveQuery` 自动响应；5 个事件全部移除（`DATA_PERSIST_NEEDED` 改为 `persistVersion` store 信号）。

## 技术选型

**Zustand v4 + `subscribeWithSelector` middleware**。理由：
1. 全局 store 概念与现有 `state` 单例天然对齐
2. 非 React 代码（events.ts/queries.ts/main.ts）可用 `useStore.getState()`/`setState()` 同步读写
3. `subscribeWithSelector` 让 main.ts 精确订阅 `persistVersion` 替代 `DATA_PERSIST_NEEDED` 事件
4. ~1KB，API 极简，学习曲线低

## Store 结构（新建 `src/core/store.ts`）

```typescript
interface KTRState {
  // 核心状态
  today: string;
  currentActivity: DailyActivity | null;
  settings: Settings;
  daysWithCompletedGoal: string[];
  persistVersion: number;  // 替代 DATA_PERSIST_NEEDED 事件

  // Actions
  setToday: () => void;
  checkDayChange: () => void;
  setCurrentActivity: (activity: DailyActivity | null) => void;
  accumulateCurrentActivityWords: (delta: number) => void;  // 不可变更新
  requestPersist: () => void;  // rAF 合并，替代 emit(DATA_PERSIST_NEEDED)
  updateSettings: (updater: (draft: Settings) => Settings) => Promise<void>;
  mutateSettings: (updater: (draft: Settings) => void) => Promise<void>;
  updateStreak: (increase: boolean) => Promise<void>;
  hydrateFromPluginData: () => void;  // 从 plugin.data 灌入 store
}
```

**不放 store 的状态**：
- `plugin` 引用 → 新建 `src/core/pluginRegistry.ts`（`getPlugin()`/`setPlugin()`），服务定位器模式
- `isUpdatingActivity` → `events.ts` 模块级变量（仅内部防重入用）
- `_reachedGoalToday` → 删除（死代码）
- DB 的 `dailyActivity` 表 → 用 `useLiveQuery` 订阅，不复制到 store

## 事件系统过渡

| 现有事件 | 过渡策略 | 替代物 |
|---------|---------|--------|
| `DATA_PERSIST_NEEDED` | 改为 store 信号 | `requestPersist()` + main.ts `subscribe(s => s.persistVersion, scheduleSave)` |
| `TODAY_DATA_CHANGED` | 移除 | DB 变化由 `useLiveQuery` 自动响应；`currentActivity` 内存变化由 store selector 响应 |
| `HISTORY_DATA_CHANGED` | 移除 | 同上 |
| `SETTINGS_CHANGED` | 移除 | `useStore(s => s.settings.*)` selector |
| `DAY_CHANGED` | 移除 | `useStore(s => s.today)` selector；`today` 变化让 `useLiveQuery` 依赖失效自动重查 |

## `getCurrentCount` 改造（`src/db/queries.ts`）

加 `ctx` 参数，让 React 组件传 store selector 值，非 React 调用方省略从 store 取：

```typescript
export interface QueryContext {
  today: string;
  currentActivity: DailyActivity | null;
  daysWithCompletedGoal: string[];
}

export async function getCurrentCount(
  target: TargetCount,
  calc?: CalculationType,
  ctx?: QueryContext,  // 缺省时从 useStore.getState() 取
): Promise<number> { ... }
```

## 组件迁移要点

### SidebarView.tsx — 5 个 `useState` + 2 事件监听 → 5 个 `useStore` selector
删除 `updateData`、`useEffect`、事件监听。`plugin` prop 不再需要。

### SlotWrapper.tsx — 直接 mutate `plugin.data.settings` + `quietSave` → `mutateSettings` action
store 更新自动反映到 `effectiveSlots`，保留本地 `slotsState` + uuid 稳定性。

### Slot.tsx — `useState value` + `updateData` + 4 事件监听 → `useLiveQuery` + store selector
- `useLiveQuery(async () => getCurrentCount(optionType, calcMode, ctx), [optionType, calcMode, today, currentActivity, daysWithCompletedGoal], 0)`
- 进度条用第二个 `useLiveQuery` 订阅 `dailyWritingGoal`
- `toggleCalculation`/`toggleUnit`/`toggleSlotType` 改用 `mutateSettings`
- 删除所有 `state.on/off`

### Entries.tsx — `useState entries` + `handleEntriesRefresh` + 3 事件监听 → `useLiveQuery`
- `useLiveQuery(async () => getActivityByDate(date).filter(...).sort(...), [date, filters], [])`
- DB 变化自动响应，`date` 变化自动重查

### Heatmap.tsx — 不改动（已用 `useLiveQuery`）
### ManualEntry.tsx — `state.*` → `useStore.getState()` / `getPlugin()`

## 非 React 代码迁移

- `events.ts`：`state.currentActivity` → `useStore.getState().currentActivity`；`activity.wordsAdded +=` → `accumulateCurrentActivityWords()`；所有 `emit(TODAY/HISTORY/DAY)` 删除；`emit(DATA_PERSIST_NEEDED)` → `requestPersist()`
- `queries.ts`：`state.today`/`state.currentActivity` → `useStore.getState()`；`emit` → `requestPersist()`
- `utils.ts`：`getExistingOrCreateNewEntry` 的 `emit` → `requestPersist()`
- `main.ts`：`state.on(DATA_PERSIST_NEEDED)` → `useStore.subscribe(s => s.persistVersion, scheduleSave)`；`updateCurrentStreak` 转调 `useStore.getState().updateStreak`；`updateAndSaveEverything` 内部调 `hydrateFromPluginData()`
- `pluginState.ts`：`plugin` getter/setter 转发到 `pluginRegistry`，Phase 5 删除整个文件

## 分阶段实施

### Phase 1：基础设施（无行为变化）
1. `npm install zustand`
2. 新建 `src/core/pluginRegistry.ts`
3. 新建 `src/core/store.ts`（完整 store 定义 + actions）
4. `pluginState.ts`：`plugin` getter/setter 转发 `pluginRegistry`，`setToday`/`checkDayChange`/`setCurrentActivity` 转发 store
5. `main.ts` `onload`：`setPlugin(this)` 后调 `useStore.getState().hydrateFromPluginData()`
- **验证**：插件正常加载，store 有数据但无消费者，旧路径全保留

### Phase 2：迁移 settings 消费者
1. `SidebarView.tsx` → 5 个 `useStore` selector
2. `SlotWrapper.tsx` → `mutateSettings` action
3. `main.ts`：`updateAndSaveEverything` 末尾加 `hydrateFromPluginData()`（确保 SettingsTab 直接 mutate 后 store 同步）
- **验证**：改 heatmap 颜色 / visibility toggle / 增删 slot，侧边栏立即响应。Slot 数值仍由旧事件驱动

### Phase 3：迁移状态 + 组件（合并原 Phase 3+4，避免桥接 emit）
1. `events.ts`：全量迁移（`isUpdatingActivity` 改模块级，`accumulateCurrentActivityWords`，删除所有 `emit`，`requestPersist()`）
2. `queries.ts`：`getCurrentCount` 加 `ctx` 参数；`deleteActivityFromDate`/`addDeltaToActivity` 用 store
3. `utils.ts`：`getExistingOrCreateNewEntry` 用 store + `requestPersist`
4. `main.ts`：`subscribe(s => s.persistVersion, scheduleSave)` 替代事件监听；`updateCurrentStreak`/`onExternalSettingsChange` 用 store
5. `Slot.tsx` → `useLiveQuery` + store selector
6. `Entries.tsx` → `useLiveQuery`
7. `HeatmapCell.tsx`/`ManualEntry.tsx`：`state.*` → `useStore.getState()`/`getPlugin()`
8. `commands.ts`/`codeBlocks.ts`/`pathFilter.ts`/`db.ts`：`state.plugin` → `getPlugin()`
- **验证**：打字 → Slot CURRENT_FILE 实时跳数；跨天 → Entries/Slot 重置；改 goal → 进度条更新；手动 entry → Entries 更新

### Phase 4：清理
1. 删除 `src/core/pluginState.ts`
2. 全局替换移除 `import { state, EVENTS } from "@/core/pluginState"`
3. `PluginView.ts`：`KTRView` 不再接收 `plugin` prop
4. `SettingsTab.ts`/`CustomSettings.ts`：`updateAndSaveEverything` → `useStore.getState().updateSettings()`（可选）
- **验证**：`rg "pluginState" src/` 无结果；`rg "EVENTS\." src/` 无结果；全量回归

## 关键风险

1. **`useLiveQuery` 对非 DB 查询**：CURRENT_FILE 不查 DB，`useLiveQuery` 仅在依赖数组变化时重跑——dexie-react-hooks 支持此用法，但 Phase 3 需验证
2. **Entries 实时性**：原代码 emit TODAY 后重查 DB 时 DB 可能还没 flush，迁移后行为一致（useLiveQuery 在 DB flush 后才更新）
3. **SettingsTab 直接 mutate**：过渡期 `updateAndSaveEverything` 末尾 `hydrateFromPluginData()` 保证 store 同步
4. **`persistVersion` subscribe**：`onunload` 需调 `unsubPersist()`

## 验证清单

- [ ] 插件加载，侧边栏渲染 3 slot + heatmap + entries
- [ ] 打字 2s 后 Slot CURRENT_FILE 跳数
- [ ] 打字 100ms 后 DB flush，Entries 数值更新
- [ ] 跨天后 Slot CURRENT_DAY 重置、Entries 标题变 "ENTRIES TODAY"
- [ ] 改 dailyWritingGoal，进度条更新
- [ ] 改 heatmap 颜色，立即变色
- [ ] 增删 slot，动画正常
- [ ] 手动添加/删除 entry，Entries 列表响应
- [ ] 重命名/删除文件，Heatmap/Entries 历史数据正确
- [ ] unload + reload，数据从 data.json 恢复
- [ ] `rg "pluginState" src/` 无结果（Phase 4 后）
