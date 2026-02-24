/**
 * 共享类型定义 — AI 客户端接口 & 消息格式。
 *
 * 这些类型被多个模块共享，独立为文件避免循环依赖和环境耦合：
 * - src/core/agent-loop.ts（决策循环）
 * - src/core/ai-client.ts（基于 fetch 的跨平台客户端）
 * - src/web/index.ts（浏览器端 WebAgent）
 *
 * 本文件零运行时依赖，仅包含 TypeScript 类型定义。
 */
import type { ToolDefinition } from "./tool-registry.js";

// ─── AI 工具调用 ───

/** AI 模型返回的工具调用指令 */
export type AIToolCall = {
  /** 调用 ID（用于将结果关联回此次调用） */
  id: string;
  /** 工具名称（如 "dom"、"page_info"） */
  name: string;
  /** AI 传入的参数 */
  input: unknown;
};

// ─── AI 消息 ───

/** 对话消息（统一格式，支持 user / assistant / tool / system 角色） */
export type AIMessage = {
  role: "user" | "assistant" | "tool" | "system";
  /** 文本内容，或工具执行结果数组 */
  content: string | Array<{ toolCallId: string; result: string }>;
  /** assistant 消息中附带的工具调用列表 */
  toolCalls?: AIToolCall[];
};

// ─── AI 响应 ───

/** AI 聊天接口的返回值 */
export type AIChatResponse = {
  /** AI 的文本回复 */
  text?: string;
  /** AI 请求的工具调用列表 */
  toolCalls?: AIToolCall[];
  /** Token 使用统计 */
  usage?: { inputTokens: number; outputTokens: number };
};

// ─── AI 客户端接口 ───

/**
 * AI 客户端抽象接口。
 *
 * 通过 createAIClient() 工厂函数创建，基于原生 fetch 实现。
 */
export type AIClient = {
  chat(params: {
    systemPrompt: string;
    messages: AIMessage[];
    tools?: ToolDefinition[];
  }): Promise<AIChatResponse>;
};
