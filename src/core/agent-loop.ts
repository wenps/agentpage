/**
 * Agent Loop — 环境无关的 AI 决策循环。
 *
 * 从 agent-core.ts 中提取的核心 Tool-Use Loop，不依赖 Node.js 或浏览器 API：
 *
 *   消息 → AI 思考 → 需要工具？──是──→ 执行工具 → 反馈结果 → 继续思考
 *                       │
 *                       否
 *                       ↓
 *                    返回最终回复
 *
 * 使用方：
 * - Node 端：agent-core.ts 的 runAgent() 调用
 * - 浏览器端：web-agent.ts 的 WebAgent.chat() 调用
 *
 * 依赖关系（全部环境无关）：
 * - types.ts       → 类型定义（import type，零运行时）
 * - tool-registry.ts → ToolRegistry 实例（注入式，非全局）
 */
import type { AIClient, AIMessage } from "./types.js";
import { ToolRegistry, type ToolCallResult } from "./tool-registry.js";

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
};

// ─── 参数与结果 ───

export type AgentLoopParams = {
  /** AI 客户端实例（Node: SDK 客户端 / Browser: fetch 客户端） */
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

const DEFAULT_MAX_ROUNDS = 10;

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
  // 将历史消息（如有）放在当前用户消息之前，实现多轮记忆
  const messages: AIMessage[] = [
    ...(history ?? []),
    { role: "user", content: message },
  ];
  const allToolCalls: AgentLoopResult["toolCalls"] = [];
  let finalReply = "";

  for (let round = 0; round < maxRounds; round++) {
    callbacks?.onRound?.(round);

    // 调用 AI（发送系统提示 + 对话历史 + 可用工具列表）
    const response = await client.chat({ systemPrompt, messages, tools });

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
    const toolResults: Array<{ toolCallId: string; result: string }> = [];

    for (const tc of response.toolCalls) {
      callbacks?.onToolCall?.(tc.name, tc.input);

      const result = await registry.dispatch(tc.name, tc.input);
      allToolCalls.push({ name: tc.name, input: tc.input, result });

      callbacks?.onToolResult?.(tc.name, result);

      toolResults.push({
        toolCallId: tc.id,
        result:
          typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content),
      });
    }

    // 将 AI 回复（含 tool_call）和工具结果追加到对话历史
    messages.push({
      role: "assistant",
      content: response.text ?? "",
      toolCalls: response.toolCalls,
    });
    messages.push({
      role: "tool",
      content: toolResults,
    });
    // → 回到循环顶部，AI 根据工具结果继续思考
  }

  // 如果有最终回复但尚未作为 assistant 消息加入历史，补充进去
  if (finalReply) {
    messages.push({ role: "assistant", content: finalReply });
  }

  return { reply: finalReply, toolCalls: allToolCalls, messages };
}
