/**
 * Agent Loop — 环境无关的 AI 决策循环。
 *
 * 核心 Tool-Use Loop，纯 TypeScript 实现：
 *
 *   消息 → AI 思考 → 需要工具？──是──→ 执行工具 → 反馈结果 → 继续思考
 *                       │
 *                       否
 *                       ↓
 *                    返回最终回复
 *
 * 使用方：WebAgent.chat() 调用
 *
 * 依赖关系（全部环境无关）：
 * - types.ts       → 类型定义（import type，零运行时）
 * - tool-registry.ts → ToolRegistry 实例（注入式，非全局）
 */
import type { AIClient, AIMessage } from "../types.js";
import { ToolRegistry, type ToolCallResult } from "../tool-registry.js";
import {
  DEFAULT_ACTION_RECOVERY_ROUNDS,
  DEFAULT_MAX_ROUNDS,
} from "./constants.js";
import {
  buildCompactMessages,
  buildToolCallKey,
  getToolAction,
  hasToolError,
  isElementNotFoundResult,
  readPageSnapshot,
  readPageUrl,
  resolveRecoveryWaitMs,
  sleep,
  stripSnapshotFromPrompt,
  toContentString,
  type ToolTraceEntry,
} from "./helpers.js";

// ─── 回调接口 ───

/** 工具调用事件回调 — 用于 UI 层实时展示 Agent 进度 */
export type AgentLoopCallbacks = {
  /** AI 返回文本回复时触发 */
  onText?: (text: string) => void;
  /** AI 请求调用工具时触发（执行前） */
  onToolCall?: (name: string, input: unknown) => void;
  /** 工具执行完成时触发 */
  onToolResult?: (name: string, result: ToolCallResult) => void;
  /** 每轮循环开始时触发（round 从 0 开始） */
  onRound?: (round: number) => void;
  /**
   * 恢复快照生成前触发（页面 URL 变化或元素定位失败时）。
   *
   * 用于 WebAgent 重置 RefStore（清空旧的 hash ID → Element 映射，
   * 用新 URL 重新生成确定性 hash），确保恢复快照中的 ID 有效。
   *
   * @param newUrl 当前页面 URL（URL 变化时传入；元素定位失败时为 undefined）
   */
  onBeforeRecoverySnapshot?: (newUrl?: string) => void;
};

// ─── 参数与结果 ───

export type AgentLoopParams = {
  /** AI 客户端实例（基于 fetch 的客户端） */
  client: AIClient;
  /** 工具注册表实例（由调用方创建并注册好工具） */
  registry: ToolRegistry;
  /** 系统提示词（由调用方构建，适配各自环境） */
  systemPrompt: string;
  /** 用户消息 */
  message: string;
  /** 历史对话消息（用于多轮记忆，按时间顺序排列） */
  history?: AIMessage[];
  /** 干运行模式：打印工具调用但不执行 */
  dryRun?: boolean;
  /** 最大工具调用轮次（默认 10） */
  maxRounds?: number;
  /** 事件回调 */
  callbacks?: AgentLoopCallbacks;
};

export type AgentLoopResult = {
  /** AI 的最终文本回复 */
  reply: string;
  /** 所有工具调用记录 */
  toolCalls: Array<{ name: string; input: unknown; result: ToolCallResult }>;
  /** 本轮完整对话消息（含历史 + 本轮，用于多轮记忆累积） */
  messages: AIMessage[];
};

type PageContextState = {
  currentUrl?: string;
  latestSnapshot?: string;
};

/**
 * 执行 Agent 决策循环（环境无关）。
 *
 * 完整流程：
 * 1. 获取已注册的工具列表
 * 2. 循环：发消息给 AI → 检查是否返回 tool_call → 执行 → 反馈 → 继续
 * 3. AI 不再调用工具时，返回最终回复
 */
export async function executeAgentLoop(
  params: AgentLoopParams,
): Promise<AgentLoopResult> {
  const {
    client,
    registry,
    systemPrompt,
    message,
    history,
    dryRun = false,
    maxRounds = DEFAULT_MAX_ROUNDS,
    callbacks,
  } = params;

  const tools = registry.getDefinitions();
  const allToolCalls: AgentLoopResult["toolCalls"] = [];
  const fullToolTrace: ToolTraceEntry[] = [];
  const actionRecoveryAttempts = new Map<string, number>();
  const pageContext: PageContextState = {};
  let finalReply = "";
  /** 连续"纯信息查询"轮次计数 — 检测 AI 空转 */
  let consecutiveReadOnlyRounds = 0;
  /** 纯信息查询工具（不改变页面状态） */
  const READ_ONLY_TOOLS = new Set(["page_info"]);

  for (let round = 0; round < maxRounds; round++) {
    callbacks?.onRound?.(round);

    // ─── 构建紧凑消息：每轮从 trace 重建，而非累积 message 对 ───
    const effectivePrompt = pageContext.latestSnapshot
      ? stripSnapshotFromPrompt(systemPrompt)
      : systemPrompt;

    const chatMessages = buildCompactMessages(
      message,
      fullToolTrace,
      pageContext.latestSnapshot,
      pageContext.currentUrl,
      history,
    );

    const response = await client.chat({
      systemPrompt: effectivePrompt,
      messages: chatMessages,
      tools,
    });

    // 没有工具调用 → 循环结束，拿到最终回复
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalReply = response.text ?? "";
      if (finalReply) callbacks?.onText?.(finalReply);
      break;
    }

    // 有文本伴随工具调用 → 先通知
    if (response.text) callbacks?.onText?.(response.text);

    // ─── Dry-run 模式 ───
    if (dryRun) {
      finalReply = response.text ? response.text + "\n\n" : "";
      finalReply += "🔧 AI 请求调用以下工具（dry-run 模式，未执行）：\n";
      for (const tc of response.toolCalls) {
        callbacks?.onToolCall?.(tc.name, tc.input);
        finalReply += `\n┌─ 工具: ${tc.name}\n`;
        finalReply += `│  ID:   ${tc.id}\n`;
        finalReply += `│  参数:\n`;
        const inputStr = JSON.stringify(tc.input, null, 2);
        for (const line of inputStr.split("\n")) {
          finalReply += `│    ${line}\n`;
        }
        finalReply += `└────────────────────\n`;
      }
      break;
    }

    // ─── 执行工具调用 ───
    // 同一轮内的多个工具调用，URL 只在轮次开头检查一次
    const latestUrl = await readPageUrl(registry);
    if (latestUrl) {
      if (!pageContext.currentUrl) {
        pageContext.currentUrl = latestUrl;
      } else if (latestUrl !== pageContext.currentUrl) {
        // URL 已变 — 拍新快照
        pageContext.currentUrl = latestUrl;
        callbacks?.onBeforeRecoverySnapshot?.(latestUrl);
        pageContext.latestSnapshot = await readPageSnapshot(registry, 6);
      }
    }

    // 批量执行所有工具调用 — 不在中间插入额外检查
    for (const tc of response.toolCalls) {
      callbacks?.onToolCall?.(tc.name, tc.input);

      // 执行工具
      let result = await registry.dispatch(tc.name, tc.input);

      // 元素未找到 → 自动恢复（刷新快照）
      if (tc.name === "dom" && isElementNotFoundResult(result)) {
        const key = buildToolCallKey(tc.name, tc.input);
        const attempts = (actionRecoveryAttempts.get(key) ?? 0) + 1;
        actionRecoveryAttempts.set(key, attempts);
        const recoveryWaitMs = resolveRecoveryWaitMs(tc.input);

        if (attempts <= DEFAULT_ACTION_RECOVERY_ROUNDS) {
          await sleep(recoveryWaitMs);
          callbacks?.onBeforeRecoverySnapshot?.();
          pageContext.latestSnapshot = await readPageSnapshot(registry, 6);

          result = {
            content: [
              toContentString(result.content),
              `Recovery ${attempts}/${DEFAULT_ACTION_RECOVERY_ROUNDS}: snapshot refreshed, re-locate target.`,
            ].join("\n"),
            details: {
              error: true,
              code: "ELEMENT_NOT_FOUND_RECOVERY",
              recoveryAttempt: attempts,
              recoveryMaxRounds: DEFAULT_ACTION_RECOVERY_ROUNDS,
            },
          };
        } else {
          result = {
            content: [
              toContentString(result.content),
              `Max recovery attempts (${DEFAULT_ACTION_RECOVERY_ROUNDS}) reached. Try a different target.`,
            ].join("\n"),
            details: {
              error: true,
              code: "ELEMENT_NOT_FOUND_MAX_RECOVERY_REACHED",
              recoveryAttempt: attempts,
              recoveryMaxRounds: DEFAULT_ACTION_RECOVERY_ROUNDS,
            },
          };
        }
      }

      allToolCalls.push({ name: tc.name, input: tc.input, result });
      fullToolTrace.push({ round, name: tc.name, input: tc.input, result });

      // 捕获显式 page_info(snapshot) 结果
      if (tc.name === "page_info" && getToolAction(tc.input) === "snapshot") {
        pageContext.latestSnapshot = toContentString(result.content);
      }

      // 导航后主动检测 URL 变化并拍快照
      if (tc.name === "navigate") {
        const action = getToolAction(tc.input);
        if (
          (action === "goto" || action === "back" || action === "forward" || action === "reload") &&
          !hasToolError(result)
        ) {
          const newUrl = await readPageUrl(registry);
          if (newUrl && newUrl !== pageContext.currentUrl) {
            pageContext.currentUrl = newUrl;
            callbacks?.onBeforeRecoverySnapshot?.(newUrl);
            pageContext.latestSnapshot = await readPageSnapshot(registry, 8);
          }
        }
      }

      callbacks?.onToolResult?.(tc.name, result);
    }

    // ─── 空转检测：AI 连续只调只读工具 → 强制终止 ───
    const allReadOnly = response.toolCalls!.every(tc => READ_ONLY_TOOLS.has(tc.name));
    if (allReadOnly) {
      consecutiveReadOnlyRounds++;
      if (consecutiveReadOnlyRounds >= 2) {
        // AI 连续 2 轮只做查询不做操作 → 任务可能已完成
        finalReply = response.text || "任务已完成。";
        if (finalReply) callbacks?.onText?.(finalReply);
        break;
      }
    } else {
      consecutiveReadOnlyRounds = 0;
    }

    // 下一轮从 trace 重建紧凑消息，无需累积
  }

  // 构建紧凑的 result.messages 供多轮记忆使用
  const resultMessages: AIMessage[] = [...(history ?? []), { role: "user", content: message }];
  if (finalReply) {
    resultMessages.push({ role: "assistant", content: finalReply });
  }

  return { reply: finalReply, toolCalls: allToolCalls, messages: resultMessages };
}

// ─── Re-exports ───
export { wrapSnapshot } from "./helpers.js";
