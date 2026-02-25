# AutoPilot TODO

## P0 — 立刻做（解决可用性）

- [x] **快照：视口裁剪** — 用 `getBoundingClientRect()` 判断元素是否在视口内，跳过不可见区域，大幅减少 token 消耗（配置项 `viewportOnly`）
- [x] **快照：智能剪枝** — 对无交互属性、无文本的纯布局 `div` 做折叠/省略，只保留交互元素和有意义文本（配置项 `pruneLayout`）
- [ ] **快照：Token 预算控制** — 增加 `maxTokenEstimate` 参数，达到预算后停止遍历，输出 `(更多元素已省略...)`
- [ ] **DOM：Shadow DOM 穿透** — 遍历时检测 `el.shadowRoot`，进入 shadow tree，ref 路径标记 `/#shadow`；同步更新 `resolveRef()` 解析逻辑
- [ ] **等待：网络空闲检测** — Hook `fetch` / `XMLHttpRequest`，追踪 pending 请求数，新增 `wait_for_network_idle` action

## P1 — 短期做（提升能力）

- [ ] **快照：分区快照** — 支持 `focusSelector` 参数，只快照指定子树（如 `/body/main/form`），按需展开深层结构
- [ ] **快照：深度自适应** — 根据节点密度动态调整 maxDepth——稀疏区域深入、密集区域提前截断
- [ ] **B端：弹窗/抽屉自动聚焦** — 检测 modal/drawer（`z-index` 最高的可见容器），自动聚焦快照到弹窗内
- [ ] **B端：表单 label-input 关联** — 识别 `<form>` 边界，将 label-input 对自动关联，让 AI 理解「姓名字段」而非「第3个input」
- [ ] **等待：DOM 稳定等待** — 执行 DOM 操作前等待 DOM 在一段时间内无变化（debounced MutationObserver）
- [ ] **等待：加载态检测** — 检测常见 loading 指示器（`.ant-spin`、`[aria-busy=true]`、skeleton），自动等待消失

## P2 — 中期做（建立壁垒）

- [ ] **视觉：页面截图能力** — 新增 `screenshot` action（`html2canvas` 或 `chrome.tabs.captureVisibleTab`）
- [ ] **视觉：Set-of-Mark 标注** — 截图时在交互元素上叠加数字标签，生成「编号 → ref 路径」映射表，供多模态模型使用
- [ ] **视觉：Canvas/SVG 感知** — 快照中标记 Canvas/SVG 的位置和尺寸，配合截图让 AI 理解图表内容
- [ ] **录制：操作录制模式** — 监听 click/input/change/submit 事件，记录 `{ action, ref, value, timestamp }` 序列
- [ ] **录制：回放引擎** — 读取录制序列，通过 ref 路径定位并执行；路径失效时调用 AI 智能修复
- [ ] **录制：操作模板导入导出** — 支持导出/导入操作序列 JSON，实现跨环境复用
- [ ] **B端：表格结构化摘要** — 识别 `<table>` / `role="grid"`，输出行列摘要而非逐行展开（节省 token）
- [ ] **B端：下拉菜单处理** — 点击后自动重新快照，捕获动态渲染的下拉选项
- [ ] **DOM：iframe 穿透（同源）** — 检测 `IFRAME`，尝试 `contentDocument` 访问，ref 路径标记 `/#iframe`
