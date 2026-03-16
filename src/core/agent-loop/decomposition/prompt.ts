/**
 * 任务分解专用 Prompt 构建。
 *
 * 两套 prompt，各司其职：
 * 1. Planning Prompt：分析快照 → 输出 JSON 子任务列表
 * 2. Micro-task Prompt：针对单个子任务的精简执行 prompt
 *
 * 设计原则（区别于主循环 system-prompt）：
 * - 更短：微循环 prompt 只关注"做好这一件事"
 * - 更聚焦：不含 REMAINING 协议、不含 assertion、不含空转检测等主循环概念
 * - 英文正文：遵循 AGENTS.md §11 规范
 */

import type { SubTask } from "./types.js";

// ─── Planning Prompt ───

/**
 * 构建规划阶段的 system prompt。
 *
 * 告诉 AI："你是一个任务规划器，分析快照并把目标拆成原子子任务"。
 */
export function buildPlanningSystemPrompt(): string {
  return [
    "You are a task planner for a web page automation agent.",
    "Your job: analyze the page snapshot and decompose the user goal into atomic sub-tasks.",
    "",
    "## Rules",
    "- Each sub-task = ONE form operation (fill a field, select a dropdown option, check a checkbox, click a button, etc.)",
    "- Use #hashID from snapshot as target when visible. If no exact hashID is available, use a descriptive text.",
    "- Order matters: put dependent actions later (e.g., submit button after all fills).",
    "- Group non-DOM-changing actions (fills/checks) before DOM-changing actions (clicks).",
    "",
    "## directExecutable Rules (CRITICAL for efficiency)",
    "The `directExecutable` flag determines whether a sub-task runs as a single tool call (true) or enters a multi-round AI loop (false).",
    "Mark `directExecutable: true` (single tool call, fast) when ALL of:",
    "  1. Target is a #hashID from the snapshot.",
    "  2. The action completes in ONE tool call with no follow-up needed.",
    "These are ALWAYS directExecutable=true when target is a #hashID:",
    "  - fill, type (text input)",
    "  - check, uncheck (checkbox/radio)",
    "  - select_option (the framework handles BOTH native and custom dropdowns internally — always direct)",
    "  - click on a visible interactive element (radio button, star, switch, tab, button that does NOT open a popup)",
    "",
    "Mark `directExecutable: false` (multi-round AI loop, slow) ONLY when:",
    "  - The interaction opens a popup/panel that requires ADDITIONAL actions inside it (e.g., open picker → set value → click OK).",
    "  - The target is a text description, not a #hashID.",
    "  - The sub-task requires a SEQUENCE of different actions to complete.",
    "Typical directExecutable=false: color pickers, date pickers with confirm, time pickers, file upload dialogs.",
    "",
    "## Popup/Panel Lifecycle",
    "When a sub-task involves opening a popup that requires confirmation:",
    "- The sub-task description MUST include the confirm step (e.g., 'Set color to red and click OK').",
    "- Mark it `directExecutable: false`.",
    "- If a popup is already open in the snapshot, include sub-tasks to complete AND close it.",
    "",
    "## Output Format",
    "Return ONLY a JSON array, no markdown fences, no explanation:",
    '[{"id":1,"action":"fill","target":"#hashID","value":"text","description":"Fill name field","directExecutable":true}, ...]',
    "",
    "Valid actions: fill, type, click, check, uncheck, select_option, press",
  ].join("\n");
}

/**
 * 构建规划阶段的 user message。
 *
 * 注入目标 + 快照 + 可选 hints。
 */
export function buildPlanningUserMessage(
  goal: string,
  snapshot: string,
  hints?: string,
): string {
  const parts: string[] = [
    `## Goal`,
    goal,
  ];
  if (hints) {
    parts.push("", "## Hints", hints);
  }
  parts.push(
    "",
    "## Current Page Snapshot",
    snapshot,
  );
  return parts.join("\n");
}

// ─── Micro-task Prompt ───

/**
 * 构建微循环的 system prompt。
 *
 * 极简版本——只告诉 AI：
 * 1. 你要完成一个具体的页面操作
 * 2. 基于快照用 #hashID 定位目标
 * 3. 完成后说 DONE，失败说 FAILED
 *
 * 不含主循环的 REMAINING 协议、效果检查等重型规则。
 */
export function buildMicroTaskSystemPrompt(): string {
  return [
    "You are a focused web page operator. You have ONE specific task to complete on the current page.",
    "",
    "## Rules",
    "- Use #hashID from snapshot as selector for all tools.",
    "- Only interactive elements (with #hashID) can be targeted.",
    "- Batch non-DOM-changing actions (fill, type, check) in one round.",
    "- A click always ends the round — send at most ONE click as the LAST action.",
    "- fill/type/select_option auto-focus the target — do NOT send a separate click before them.",
    "- If a click fails or has no effect, try: (1) a child element inside the target; (2) the parent with click listeners; (3) evaluate to trigger programmatically.",
    "",
    "## Popup/Panel Lifecycle",
    "- Some controls open a popup/panel/overlay that requires confirmation (e.g., pickers with OK button).",
    "- A popup interaction is NOT complete until the popup is dismissed: click OK/confirm, or click outside.",
    "- If the snapshot shows an open popup related to your task, close/confirm it before reporting DONE.",
    "",
    "## Completion Protocol (CRITICAL)",
    "After your tool calls, you MUST include exactly one of these status lines:",
    "- MICROTASK: DONE — task achieved (value set, popup closed if any)",
    "- MICROTASK: RETRY — need another attempt",
    "- MICROTASK: FAILED reason — impossible to complete",
    "",
    "IMPORTANT: If your tool call succeeded without error, the task is likely done. Output MICROTASK: DONE immediately.",
    "Do NOT spend extra rounds verifying — the framework tracks success automatically.",
  ].join("\n");
}

/**
 * 构建微循环的 user message。
 *
 * 极简结构：任务描述 + 可选的上一轮结果 + 最新快照。
 */
export function buildMicroTaskUserMessage(
  subTask: SubTask,
  snapshot: string,
  currentUrl?: string,
  previousAttemptSummary?: string,
): string {
  const parts: string[] = [
    `## Task`,
    `${subTask.description}`,
  ];
  if (subTask.action) {
    parts.push(`Action: ${subTask.action}`);
  }
  if (subTask.target) {
    parts.push(`Target: ${subTask.target}`);
  }
  if (subTask.value !== undefined) {
    parts.push(`Value: ${subTask.value}`);
  }
  if (previousAttemptSummary) {
    parts.push("", "## Previous Attempt", previousAttemptSummary);
  }
  if (currentUrl) {
    parts.push("", `URL: ${currentUrl}`);
  }
  parts.push(
    "",
    "## Snapshot",
    snapshot,
  );
  return parts.join("\n");
}
