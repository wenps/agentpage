/**
 * 紧凑消息构建（中）/ Compact message construction (EN).
 *
 * 目标：让 AI 每轮只基于“主目标 + 已完成步骤 + 最新快照”做增量决策。
 * Goal: enforce incremental decisions from master goal, done steps, and latest snapshot.
 */
import type { ToolCallResult } from "../tool-registry.js";
import type { AIMessage } from "../types.js";
import { toContentString, hasToolError } from "./helpers.js";
import { wrapSnapshot, SNAPSHOT_REGEX } from "./snapshot.js";
import type { ToolTraceEntry } from "./types.js";

/**
 * 显式 UI 意图判定（中）/ Detect explicit intent to operate AutoPilot UI (EN).
 */
export function isExplicitAgentUiRequest(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  const compact = lower.replace(/[\s\p{P}\p{S}]+/gu, "");

  const hasAgentUiKeyword =
    /(chat|dock|chatinput|sendbutton|shortcut|quicktest)/i.test(lower) ||
    /(聊天|对话|指令输入框|消息输入框|输入框|发送按钮|发送|快捷测试|测试按钮|聊天面板)/.test(compact);

  const hasActionVerb =
    /(press|click|type|fill|send|input|submit|enter)/i.test(lower) ||
    /(输入|点击|发送|填写|填入|操作|提交|回车|按下)/.test(compact);
  return hasAgentUiKeyword && hasActionVerb;
}

// ─── 格式化辅助 ───

/** 输入摘要（中）/ Build brief text for tool input (EN). */
export function formatToolInputBrief(input: unknown): string {
  if (!input || typeof input !== "object") return "";

  const params = input as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of ["action", "selector", "waitMs", "waitSeconds", "url", "text"]) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      parts.push(`${key}=${JSON.stringify(value).slice(0, 80)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${String(value)}`);
    }
  }

  if (parts.length === 0) return "";
  return ` (${parts.join(", ")})`;
}

/**
 * 结果摘要（中）/ Build one-line summary for tool result (EN).
 */
function formatToolResultBrief(result: ToolCallResult): string {
  const content = toContentString(result.content);
  const firstLine = content.split("\n").find(l => l.trim())?.trim().slice(0, 80) ?? "";

  if (hasToolError(result)) {
    const code = result.details && typeof result.details === "object"
      ? (result.details as { code?: string }).code
      : undefined;
    return `✗ ${firstLine}${code ? ` [${code}]` : ""}`;
  }
  return `✓ ${firstLine}`;
}

// ─── 轨迹格式化 ───

/**
 * 轨迹格式化（中）/ Format full tool trace to readable text (EN).
 */
export function buildToolTrace(
  trace: ToolTraceEntry[],
  current?: {
    round: number;
    name: string;
    input: unknown;
    result?: ToolCallResult;
    marker?: string;
  },
): string {
  const lines = trace.map((entry, index) => {
    const code =
      entry.result.details && typeof entry.result.details === "object"
        ? (entry.result.details as { code?: unknown }).code
        : undefined;
    const codeText = typeof code === "string" ? ` [${code}]` : "";
    const marker = entry.marker ? ` ${entry.marker}` : "";
    return `${index + 1}. [round ${entry.round}] ${entry.name}${formatToolInputBrief(entry.input)}${codeText}${marker}`;
  });

  if (current) {
    const code =
      current.result?.details && typeof current.result.details === "object"
        ? (current.result.details as { code?: unknown }).code
        : undefined;
    const codeText = typeof code === "string" ? ` [${code}]` : "";
    const marker = current.marker ? ` ${current.marker}` : "";
    lines.push(
      `${lines.length + 1}. [round ${current.round}] ${current.name}${formatToolInputBrief(current.input)}${codeText}${marker}`,
    );
  }

  return lines.length > 0 ? lines.join("\n") : "(暂无工具执行记录)";
}

// ─── 紧凑消息构建 ───

/**
 * 构建紧凑消息数组（中）/ Build compact AI message array (EN).
 *
 * Round 0: task + snapshot.
 * Round 1+: master goal + done steps + execution context + latest snapshot.
 *
 * 新增渐进式语义（中）/ Progressive semantics (EN):
 * - `remainingInstruction`：当前轮次仍待执行的文本。
 * - `previousRoundTasks`：上一轮已执行的任务数组，避免重复计划。
 * - 消息中要求模型输出 `REMAINING: ...` 或 `REMAINING: DONE`，供下一轮继续消费。
 */
export function buildCompactMessages(
  userMessage: string,
  trace: ToolTraceEntry[],
  latestSnapshot: string | undefined,
  currentUrl: string | undefined,
  history?: AIMessage[],
  remainingInstruction?: string,
  previousRoundTasks?: string[],
): AIMessage[] {
  const messages: AIMessage[] = history ? [...history] : [];
  const allowAgentUiInteraction = isExplicitAgentUiRequest(userMessage);
  const activeInstruction = (remainingInstruction && remainingInstruction.trim())
    ? remainingInstruction.trim()
    : userMessage;

  // ─── Round 0：任务描述 + 快照，一条消息搞定 ───
  if (trace.length === 0) {
    // 中文释义：Round 0 发送给模型的信息结构
    // 1) 当前用户目标
    // 2) 当前轮次剩余任务文本
    // 3) 当前 URL（如有）
    // 4) 最新快照 + 执行约束（禁 page_info、禁误触 AI UI、下拉框用 select_option/fill）
    const parts: string[] = [
      userMessage,
      "",
      "## Progressive execution state",
      "Current remaining instruction to execute this round:",
      activeInstruction,
    ];
    if (currentUrl) {
      parts.push("", `URL: ${currentUrl}`);
    }
    if (latestSnapshot) {
      parts.push(
        "",
        "## Current page snapshot",
        "Use hash IDs (e.g. #a1b2c) from the snapshot as selector params.",
        "Do NOT call page_info — the snapshot below is your only source of truth.",
        "For dropdown/select fields, use dom with action=select_option (or fill on a select). Do NOT rely on click-only selection.",
        allowAgentUiInteraction
          ? "User explicitly asked to operate AutoPilot UI. You may interact with chat input/send/dock only as requested."
          : "Do NOT interact with any AI chat UI elements (chat input, send button, dock). Only operate on the actual page content.",
        wrapSnapshot(latestSnapshot),
      );
    }
    messages.push({ role: "user", content: parts.join("\n") });
    return messages;
  }

  // ─── Round 1+：原始任务 + 已完成步骤 + 执行上下文与快照 ───

  // 第 1 条：用户原始消息始终独立保留（AI 的终极目标）
  messages.push({ role: "user", content: userMessage });

  // 第 2 条：已完成步骤摘要（从 fullToolTrace 重建）
  const traceParts: string[] = [];
  for (let i = 0; i < trace.length; i++) {
    const entry = trace[i];
    const isError = hasToolError(entry.result);
    const brief = formatToolResultBrief(entry.result);
    const status = isError ? "❌" : "✅";
    const marker = entry.marker ? ` ${entry.marker}` : "";
    traceParts.push(
      `${status} ${i + 1}. ${entry.name}${formatToolInputBrief(entry.input)} → ${brief}${marker}`,
    );
  }
  messages.push({
    role: "assistant",
    content: `Done steps (do NOT repeat):\n${traceParts.join("\n")}`,
  });

  // 第 3 条：执行上下文 + 最新快照
  const hasErrors = trace.some(e => hasToolError(e.result));
  const contextParts: string[] = [
    // 中文释义：Round 1+ 执行上下文
    // - Master goal: 原始总目标，不变
    // - Current remaining instruction: 当前尚未完成的子任务文本
    // - Completed steps: 已完成步骤不重复
    // - Snapshot constraints: 只基于最新快照执行；不跨 DOM 变化链式操作
    "## Execution context",
    "Master goal:",
    userMessage,
    "",
    "Current remaining instruction:",
    activeInstruction,
    "",
    "Completed steps are listed above. Look at the snapshot below and execute all remaining sub-tasks whose targets are currently visible.",
    "Do NOT act on elements that don't exist in this snapshot yet (e.g. modal content before opening the modal).",
    "Do NOT call page_info — the snapshot is already provided below.",
    "For dropdown/select fields, use dom with action=select_option (or fill on a select). Do NOT rely on click-only selection.",
    allowAgentUiInteraction
      ? "User explicitly asked to operate AutoPilot UI. You may interact with chat input/send/dock only as requested."
      : "Do NOT interact with any AI chat UI elements (chat input, send button, dock). Only operate on the actual page content.",
  ];

  if (hasErrors) {
    contextParts.push(
      "",
      "The last step failed. Retry with a different approach, or skip and continue with other visible targets.",
    );
  } else {
    contextParts.push(
      "",
      "If the goal is fully done, reply with a short summary (no tool calls).",
    );
  }

  if (previousRoundTasks && previousRoundTasks.length > 0) {
    contextParts.push(
      "",
      "Previous round planned task array (already executed):",
      ...previousRoundTasks.map((task, index) => `${index + 1}. ${task}`),
    );
  }

  contextParts.push(
    // 中文释义：要求模型显式返回剩余任务协议
    // - REMAINING: <text> 还有未完成
    // - REMAINING: DONE 当前任务文本已消费完
    "",
    "After planning this round, if there is still unfinished part of the instruction, include one plain text line:",
    "REMAINING: <what is still left>",
    "If nothing is left, include one plain text line: REMAINING: DONE",
  );

  // 最近失败操作详情
  const lastEntry = trace[trace.length - 1];
  if (hasToolError(lastEntry.result)) {
    const detail = toContentString(lastEntry.result.content);
    const stripped = detail.replace(SNAPSHOT_REGEX, "").trim();
    if (stripped && stripped.length < 300) {
      contextParts.push("", "Last error: " + stripped);
    }
  }

  if (currentUrl) {
    contextParts.push("", `URL: ${currentUrl}`);
  }

  if (latestSnapshot) {
    contextParts.push(
      "",
      "## Latest DOM snapshot",
      "Use hash IDs from this snapshot. Do NOT call page_info — this is already the latest.",
      wrapSnapshot(latestSnapshot),
    );
  }

  messages.push({ role: "user", content: contextParts.join("\n") });

  return messages;
}
