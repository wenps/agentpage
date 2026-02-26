/**
 * Agent Loop 辅助函数集合。
 *
 * 该文件只放“纯辅助逻辑”：格式化、判定、上下文读取、等待等，
 * 让 `agent-loop.ts` 专注于流程编排。
 */
import type { ToolCallResult } from "../tool-registry.js";
import { ToolRegistry } from "../tool-registry.js";
import type { AIMessage } from "../types.js";
import {
  DEFAULT_RECOVERY_WAIT_MS,
  SNAPSHOT_END,
  SNAPSHOT_OUTDATED,
  SNAPSHOT_START,
} from "./constants.js";

/** 单次工具执行轨迹条目（用于恢复提示和调试展示）。 */
export type ToolTraceEntry = {
  round: number;
  name: string;
  input: unknown;
  result: ToolCallResult;
  marker?: string;
};

/** 异步睡眠，确保恢复重试按顺序串行执行。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 将工具返回内容统一转为字符串，便于拼接进消息。 */
export function toContentString(content: ToolCallResult["content"]): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

/** 判定工具失败是否属于“元素不存在”，用于触发快照恢复。 */
export function isElementNotFoundResult(result: ToolCallResult): boolean {
  const details = result.details;
  if (details && typeof details === "object") {
    const code = (details as { code?: unknown }).code;
    if (code === "ELEMENT_NOT_FOUND") return true;
  }

  const content = toContentString(result.content);
  return content.includes("未找到") && content.includes("元素");
}

/** 为同一动作构造稳定 key，用于统计恢复重试次数。 */
export function buildToolCallKey(name: string, input: unknown): string {
  return `${name}:${JSON.stringify(input)}`;
}

/**
 * 解析恢复等待时长：
 * - 优先 `waitMs`
 * - 其次 `waitSeconds`
 * - 最后回退默认值
 */
export function resolveRecoveryWaitMs(input: unknown): number {
  if (!input || typeof input !== "object") return DEFAULT_RECOVERY_WAIT_MS;

  const params = input as Record<string, unknown>;
  const waitMs = params.waitMs;
  if (typeof waitMs === "number" && Number.isFinite(waitMs)) {
    return Math.max(0, Math.floor(waitMs));
  }

  const waitSeconds = params.waitSeconds;
  if (typeof waitSeconds === "number" && Number.isFinite(waitSeconds)) {
    return Math.max(0, Math.floor(waitSeconds * 1000));
  }

  return DEFAULT_RECOVERY_WAIT_MS;
}

/** 将工具输入压缩成简短文本，用于轨迹展示。 */
function formatToolInputBrief(input: unknown): string {
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
 * 将完整轨迹格式化为可读文本。
 * 支持附加“当前步骤”用于在恢复提示中高亮失败动作。
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

/** 从工具参数中读取 action。 */
export function getToolAction(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const action = (input as Record<string, unknown>).action;
  return typeof action === "string" ? action : undefined;
}

/** 判定工具结果是否标记 error。 */
export function hasToolError(result: ToolCallResult): boolean {
  return result.details && typeof result.details === "object"
    ? Boolean((result.details as { error?: unknown }).error)
    : false;
}

/** 读取当前页面 URL（通过 page_info 工具）。 */
export async function readPageUrl(
  registry: ToolRegistry,
): Promise<string | undefined> {
  const result = await registry.dispatch("page_info", { action: "get_url" });
  return typeof result.content === "string" ? result.content : undefined;
}

/** 读取当前页面快照（通过 page_info 工具）。 */
export async function readPageSnapshot(
  registry: ToolRegistry,
  maxDepth = 8,
): Promise<string> {
  const result = await registry.dispatch("page_info", {
    action: "snapshot",
    maxDepth,
  });
  return toContentString(result.content);
}

// ─── DOM 快照去重 ───

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 匹配快照标记对及其内容的正则 */
const SNAPSHOT_REGEX = new RegExp(
  `${escapeRegex(SNAPSHOT_START)}[\\s\\S]*?${escapeRegex(SNAPSHOT_END)}`,
  "g",
);

/** 用标记包裹快照内容，便于后续去重识别。 */
export function wrapSnapshot(snapshot: string): string {
  return `${SNAPSHOT_START}\n${snapshot}\n${SNAPSHOT_END}`;
}

/** 检测文本中是否包含快照标记。 */
function containsSnapshot(text: string): boolean {
  return text.includes(SNAPSHOT_START);
}

/**
 * 去重消息中的 DOM 快照：只保留最后一份，旧的替换为占位摘要。
 * 避免多轮对话中快照滚雪球式累积，大幅减少 token 消耗。
 *
 * @returns 消息中是否存在快照（用于决定是否需要剥离 system prompt 中的快照）
 */
export function deduplicateSnapshots(messages: AIMessage[]): boolean {
  type SnapshotRef = {
    items: Array<{ toolCallId: string; result: string }>;
    index: number;
  };
  const refs: SnapshotRef[] = [];

  for (const msg of messages) {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
    const items = msg.content as Array<{ toolCallId: string; result: string }>;
    for (let j = 0; j < items.length; j++) {
      if (typeof items[j].result === "string" && containsSnapshot(items[j].result)) {
        refs.push({ items, index: j });
      }
    }
  }

  if (refs.length <= 1) return refs.length > 0;

  // 保留最后一份快照，将更早的快照替换为过期提示
  for (let i = 0; i < refs.length - 1; i++) {
    const ref = refs[i];
    ref.items[ref.index].result = ref.items[ref.index].result.replace(
      SNAPSHOT_REGEX,
      SNAPSHOT_OUTDATED,
    );
  }

  return true;
}

/**
 * 从 system prompt 中剥离已过期的快照内容。
 * 当消息历史中已有更新的快照时调用，避免 AI 参考过时信息。
 */
export function stripSnapshotFromPrompt(prompt: string): string {
  if (!containsSnapshot(prompt)) return prompt;
  return prompt.replace(SNAPSHOT_REGEX, SNAPSHOT_OUTDATED);
}

// ─── 消息压缩 ───

/**
 * 格式化工具结果为简短一行摘要。
 * 成功操作保留首行描述；失败操作标注错误代码。
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

/**
 * 构建发送给 AI 的紧凑消息数组。
 *
 * 核心思路：保留用户原始消息与 system prompt 不变，
 * 只将循环中产出的 assistant（含 toolCalls）+ tool（结果）消息对
 * 压缩为一条 assistant 摘要 + 一条 user 上下文。
 *
 * 消息结构：
 * - 首轮：[...history, { user: 原始消息 }]
 * - 后续：[...history, { user: 原始消息 }, { assistant: 工具执行摘要 }, { user: 当前状态+快照 }]
 *
 * 固定最多 history.length + 3 条消息，不随轮次增长。
 */
export function buildCompactMessages(
  userMessage: string,
  trace: ToolTraceEntry[],
  latestSnapshot: string | undefined,
  currentUrl: string | undefined,
  history?: AIMessage[],
): AIMessage[] {
  const messages: AIMessage[] = history ? [...history] : [];

  // 用户原始消息始终独立保留
  messages.push({ role: "user", content: userMessage });

  // 首轮无工具执行，直接返回
  if (trace.length === 0) return messages;

  // ─── 压缩 assistant+tool 消息对为一条 assistant 摘要 ───
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

  // ─── 当前页面状态 + 快照，作为 user 消息 ───
  // 检查是否所有步骤都已成功（无失败）— 提示 AI 可以停止
  const hasErrors = trace.some(e => hasToolError(e.result));
  const contextParts: string[] = hasErrors
    ? ["Continue. Batch all tool calls whose targets are in the snapshot. Do not repeat ✅ steps."]
    : ["If the user's task is fully done, reply with a short summary (no tool calls). Otherwise continue with remaining steps."];

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
    contextParts.push("", "## Current DOM snapshot", wrapSnapshot(latestSnapshot));
  }

  messages.push({ role: "user", content: contextParts.join("\n") });

  return messages;
}
