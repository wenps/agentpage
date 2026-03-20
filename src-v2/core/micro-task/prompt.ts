/**
 * 微任务专用提示词构建器。
 *
 * ─── 与 shared/system-prompt.ts 的区别 ───
 *
 * | 维度 | Main Agent (buildSystemPrompt) | Micro-task (buildMicroTaskPrompt) |
 * |------|-------------------------------|----------------------------------|
 * | 角色 | "AutoPilot" 全能指挥官        | "Micro-task Agent" 聚焦执行者     |
 * | 规则 | 32+ 条完整规则 + 调度能力       | 精简 DOM 操作规则（去掉调度相关）    |
 * | 上下文 | 用户完整指令                  | 微任务描述 + Previously completed  |
 * | 范围 | 全页面操作 + 导航              | 聚焦当前任务描述的区域              |
 *
 * ─── 设计决策 ───
 *
 * 1. 精简规则：去掉 Execution Strategy（微任务不分派子任务）、
 *    dispatch_micro_task 相关说明，只保留 DOM 操作核心规则。
 *
 * 2. Previously completed 注入：将上一个微任务的执行记录精简摘要
 *    注入到 prompt 中，让当前微任务知道哪些工作已完成，避免重复操作。
 *
 * 3. 聚焦指令：明确告知 AI "Focus ONLY on your assigned task"，
 *    防止微任务 Agent 越界操作其他区域。
 *
 * ─── 在 v2 架构中的位置 ───
 *
 * ```
 * core/
 * ├── shared/system-prompt.ts  ← Main Agent 使用
 * ├── micro-task/
 * │   ├── prompt.ts            ← 【当前文件】Micro-task Agent 使用
 * │   ├── types.ts
 * │   ├── record.ts
 * │   └── task-monitor.ts
 * └── main-agent/
 *     └── dispatch.ts          ← 调用本模块构建微任务 prompt
 * ```
 */

/**
 * 微任务提示词构建参数。
 */
export type MicroTaskPromptParams = {
  /** 微任务目标描述（自然语言） */
  task: string;
  /**
   * 之前已完成的微任务上下文（由 ExecutionRecordChain.buildPreviousContext() 生成）。
   *
   * 示例：
   * ```
   * ✅ 填写基本信息: 姓名=张三, 性别=男, 年龄=30
   * ✅ 填写联系方式: 手机=13800138000, 邮箱=xxx@xx.com
   * ```
   *
   * 空链时值为 "(no prior micro-tasks)"。
   */
  previouslyCompleted: string;
  /**
   * 允许在 Listener Abbrevs 中输出的事件白名单（可选）。
   * 不传时使用默认列表。
   */
  listenerEvents?: string[];
  /** AI 思考深度标签（可选） */
  thinkingLevel?: string;
};

// 事件简写映射（与 shared/system-prompt.ts 保持一致）
const LISTENER_ABBREV_MAP: Record<string, string> = {
  click: "clk",
  dblclick: "dbl",
  mousedown: "mdn",
  mouseup: "mup",
  mousemove: "mmv",
  mouseover: "mov",
  mouseout: "mot",
  mouseenter: "men",
  mouseleave: "mlv",
  pointerdown: "pdn",
  pointerup: "pup",
  pointermove: "pmv",
  touchstart: "tst",
  touchend: "ted",
  keydown: "kdn",
  keyup: "kup",
  input: "inp",
  change: "chg",
  submit: "sub",
  focus: "fcs",
  blur: "blr",
  scroll: "scl",
  wheel: "whl",
  drag: "drg",
  dragstart: "drs",
  dragend: "dre",
  drop: "drp",
  contextmenu: "ctx",
};

const DEFAULT_LISTENER_EVENTS = [
  "click",
  "input",
  "change",
  "mousedown",
  "pointerdown",
  "keydown",
  "submit",
  "focus",
  "blur",
];

function buildListenerAbbrevLine(listenerEvents?: string[]): string {
  const allowed =
    listenerEvents && listenerEvents.length > 0
      ? listenerEvents
      : DEFAULT_LISTENER_EVENTS;

  const normalized = allowed
    .map((event) => event.trim().toLowerCase())
    .filter(Boolean);

  const unique = [...new Set(normalized)];
  const pairs = unique
    .map((event) => {
      const abbrev = LISTENER_ABBREV_MAP[event];
      return abbrev ? `${abbrev}=${event}` : null;
    })
    .filter((pair): pair is string => !!pair);

  return pairs.join(" ");
}

/**
 * 构建微任务专用系统提示词。
 *
 * 输出结构（按章节顺序）：
 * 1. **Role** — 微任务 Agent 角色定义
 * 2. **Your Task** — 当前微任务的具体目标
 * 3. **Previously Completed** — 之前微任务的执行记录摘要
 * 4. **Core Rules** — 精简的 DOM 操作规则（去掉调度/导航/编排相关）
 * 5. **Listener Abbrevs** — 事件简写对照表
 * 6. **Output** — 输出协议
 * 7. **Reasoning Profile**（可选）— 思考深度
 *
 * @param params - 构建参数
 * @returns 完整的微任务系统提示词字符串（英文）
 */
export function buildMicroTaskPrompt(params: MicroTaskPromptParams): string {
  const sections: string[] = [];

  // ─── 章节 1: 角色定义 + 任务 + 上下文 + 核心规则 ───
  sections.push(
    [
      "You are a Micro-task Agent of AutoPilot.",
      "You execute ONE specific task on the current page via DOM tools.",
      "Focus ONLY on your assigned task — ignore other parts of the page that are not related to it.",
      "",

      "## Your Task",
      params.task,
      "",

      "## Previously Completed",
      params.previouslyCompleted,
      "",

      "## Core Rules",

      "- Work from CURRENT snapshot + remaining task. Do not restate.",
      "- Task reduction: (remaining, prev actions, this-round) → new remaining.",
      "- Use #hashID from snapshot as selector. Do not guess CSS selectors.",
      "- Only interactive elements carry #hashID; others are context-only and cannot be targeted.",

      "- Bracket tag may show ARIA role ([combobox], [slider]) as primary interaction hint.",
      "- listeners=\"...\" = bound event handlers (abbrevs below). Prefer targets with matching listeners.",
      "- Click target MUST have click signal: listeners containing clk/pdn/mdn, or onclick attr, or native <a>/<button>, or role=button/link. NEVER click elements with only blr/fcs (focus/blur) — they are not click targets.",
      "- If the text you want to click has no click signal, look at its parent row/container or nearby sibling that does have clk listener.",
      "- No-effect fallback: if a click produced no page change (snapshot unchanged), do NOT repeat the same target. Instead: (1) look for <a> links or <button> inside the clicked container; (2) try a parent or sibling with stronger click signal; (3) try a completely different approach.",

      "- Batch fill/type/check/select_option freely within one round. A click always ends the round — send at most ONE click as the LAST action in a batch.",
      "- fill/type/select_option auto-focus: these actions automatically click and focus the target before input — do NOT send a separate focus/click before them.",
      "- Search/filter inputs: after fill, press Enter (or click search button) to trigger the search. Do not assume fill alone submits.",

      "- Steppers: compute delta from visible value, click exactly |delta| times. Check/uncheck: target real input control.",
      "- DOM-changing action (click/modal/navigate): ends the round, next snapshot follows. Actions sent after a click in the same batch are discarded.",
      "- Effect check: before planning new actions, confirm previous actions' expected effects are visible in current snapshot. If the snapshot is unchanged after a click, the click FAILED — pick a different element.",
      "- page_info.snapshot is an INTERNAL framework action. Snapshot is auto-refreshed and provided every round. Other page_info actions (get_url, get_title, get_viewport, query_all, get_selection) are allowed when needed.",
      "- Never repeat the same tool call (same name + same args) on the same target. If it didn't work, try a different approach.",
      "- Dropdown/select: prefer dom.select_option (works in one round). For custom dropdowns requiring click-to-open: click → wait for next snapshot → click option (two rounds).",
      "- Omitted children: output `SNAPSHOT_HINT: EXPAND_CHILDREN #<ref>`, wait for next snapshot.",
      "- Do NOT verify values unless user explicitly asks.",
      "- Completion = visible outcome in snapshot, not every planned sub-step executed. If snapshot already shows the expected result, the task IS done.",
      "- Stop: when remaining task is fully achieved (confirmed in snapshot), output REMAINING: DONE with a summary.",
      "- Do NOT interact with AutoPilot UI unless user asks.",
      "",

      // ─── 事件简写对照表 ───
      "## Listener Abbrevs",
      buildListenerAbbrevLine(params.listenerEvents),
      "",

      // ─── 输出协议 ───
      "## Output",
      "Tool calls + one text line: REMAINING: <new remaining> or REMAINING: DONE",
    ].join("\n"),
  );

  // ─── 思考深度（可选） ───
  if (params.thinkingLevel) {
    sections.push(
      ["## Reasoning Profile", `- Thinking level: ${params.thinkingLevel}`].join(
        "\n",
      ),
    );
  }

  return sections.join("\n\n");
}
