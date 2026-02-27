/**
 * DOM 快照生命周期管理（中）/ DOM snapshot lifecycle management (EN).
 *
 * 负责读取、包裹、去重、剥离。
 * Handles read, wrap, deduplicate, and strip operations.
 */
import { ToolRegistry } from "../tool-registry.js";
import type { AIMessage } from "../types.js";
import {
  SNAPSHOT_END,
  SNAPSHOT_OUTDATED,
  SNAPSHOT_START,
} from "./constants.js";
import { toContentString } from "./helpers.js";

// ─── 快照读取 ───

/** 读取页面 URL（中）/ Read current page URL via page_info (EN). */
export async function readPageUrl(
  registry: ToolRegistry,
): Promise<string | undefined> {
  const result = await registry.dispatch("page_info", { action: "get_url" });
  return typeof result.content === "string" ? result.content : undefined;
}

/**
 * 读取页面快照（中）/ Read current page snapshot (EN).
 *
 * 默认关闭 viewportOnly，优先完整性。
 * viewportOnly defaults to false to prioritize completeness.
 */
export async function readPageSnapshot(
  registry: ToolRegistry,
  options?: {
    maxDepth?: number;
    viewportOnly?: boolean;
    pruneLayout?: boolean;
    maxNodes?: number;
    maxChildren?: number;
    maxTextLength?: number;
  },
): Promise<string> {
  const result = await registry.dispatch("page_info", {
    action: "snapshot",
    maxDepth: options?.maxDepth ?? 8,
    viewportOnly: options?.viewportOnly ?? false,
    pruneLayout: options?.pruneLayout ?? true,
    maxNodes: options?.maxNodes ?? 500,
    maxChildren: options?.maxChildren ?? 30,
    maxTextLength: options?.maxTextLength ?? 40,
  });
  return toContentString(result.content);
}

// ─── 快照标记 ───

/** 包裹快照（中）/ Wrap snapshot with boundary markers (EN). */
export function wrapSnapshot(snapshot: string): string {
  return `${SNAPSHOT_START}\n${snapshot}\n${SNAPSHOT_END}`;
}

// ─── 快照去重 ───

/** 转义正则字符（中）/ Escape regex special chars (EN). */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 快照块匹配正则（中）/ Regex for snapshot blocks (EN). */
const SNAPSHOT_REGEX = new RegExp(
  `${escapeRegex(SNAPSHOT_START)}[\\s\\S]*?${escapeRegex(SNAPSHOT_END)}`,
  "g",
);

/** 是否包含快照标记（中）/ Check whether text includes snapshot markers (EN). */
function containsSnapshot(text: string): boolean {
  return text.includes(SNAPSHOT_START);
}

/**
 * 去重消息快照（中）/ Deduplicate snapshots in messages (EN).
 * 仅保留最后一份快照，旧快照替换为过期提示。
 * Keep only the latest snapshot and mark older ones as outdated.
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
 * 剥离旧快照（中）/ Strip outdated snapshot blocks from system prompt (EN).
 */
export function stripSnapshotFromPrompt(prompt: string): string {
  if (!containsSnapshot(prompt)) return prompt;
  return prompt.replace(SNAPSHOT_REGEX, SNAPSHOT_OUTDATED);
}

/** 导出快照正则（中）/ Export snapshot regex for message helpers (EN). */
export { SNAPSHOT_REGEX };
