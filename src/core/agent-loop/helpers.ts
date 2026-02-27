/**
 * Agent Loop 辅助函数（中）/ Agent loop helpers (EN).
 *
 * 仅包含纯函数与无副作用工具。
 * Pure utilities only (no side effects).
 */
import type { ToolCallResult } from "../tool-registry.js";
import { DEFAULT_RECOVERY_WAIT_MS } from "./constants.js";

/** 异步睡眠（中）/ Async sleep utility (EN). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 统一内容为字符串（中）/ Normalize tool content to string (EN). */
export function toContentString(content: ToolCallResult["content"]): string {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

/** 元素不存在判定（中）/ Detect element-not-found failure (EN). */
export function isElementNotFoundResult(result: ToolCallResult): boolean {
  const details = result.details;
  if (details && typeof details === "object") {
    const code = (details as { code?: unknown }).code;
    if (code === "ELEMENT_NOT_FOUND") return true;
  }

  const content = toContentString(result.content);
  return content.includes("未找到") && content.includes("元素");
}

/** 生成稳定调用键（中）/ Build stable key for a tool call (EN). */
export function buildToolCallKey(name: string, input: unknown): string {
  return `${name}:${JSON.stringify(input)}`;
}

/**
 * 解析恢复等待时长（中）/ Resolve recovery wait duration (EN).
 * 优先级：waitMs > waitSeconds > 默认值。
 * Priority: waitMs > waitSeconds > default value.
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

/** 读取工具 action（中）/ Read tool action from input (EN). */
export function getToolAction(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const action = (input as Record<string, unknown>).action;
  return typeof action === "string" ? action : undefined;
}

/** 判定错误标记（中）/ Check whether result is marked as error (EN). */
export function hasToolError(result: ToolCallResult): boolean {
  return result.details && typeof result.details === "object"
    ? Boolean((result.details as { error?: unknown }).error)
    : false;
}
