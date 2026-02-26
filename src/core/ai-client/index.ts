/**
 * AI Client — 基于 fetch 的 AI 客户端（主入口）。
 *
 * 使用原生 fetch API，浏览器天然支持，不依赖任何 SDK，零环境耦合。
 *
 * 支持四种 provider：
 * - "openai"    → OpenAI API (https://api.openai.com/v1)
 * - "copilot"   → GitHub Models API (https://models.inference.ai.azure.com)
 * - "anthropic" → Anthropic API (https://api.anthropic.com)
 * - "deepseek"  → DeepSeek API (https://api.deepseek.com)
 *
 * 提供两层 API：
 * - 高层：createAIClient(config) → AIClient（工厂函数，自动选择客户端类）
 * - 类：OpenAIClient / AnthropicClient / BaseAIClient（直接实例化）
 *
 * 类继承体系：
 *   BaseAIClient（custom.ts）— 可继承的基类，用户自定义 AI 对接
 *     ├── OpenAIClient（openai.ts）— OpenAI / Copilot 实现
 *     └── AnthropicClient（anthropic.ts）— Anthropic 实现
 *
 * 文件组织：
 *   ai-client/index.ts          ← 主入口（本文件）：类型定义 + dispatcher + re-export
 *   ai-client/custom.ts         ← BaseAIClient 基类（用户自定义 AI 对接）
 *   ai-client/openai.ts         ← OpenAIClient + OpenAI 格式转换
 *   ai-client/anthropic.ts      ← AnthropicClient + Anthropic 格式转换
 *   ai-client/constants.ts      ← 端点映射 + 共享工具函数
 *
 * 使用方：
 *   core/ai-client.ts ←── web/index.ts（WebAgent）
 */
import type { AIClient, AIChatResponse, AIMessage } from "../types.js";
import type { ToolDefinition } from "../tool-registry.js";
import { validateProvider } from "./constants.js";
import { OpenAIClient } from "./openai.js";
import { AnthropicClient } from "./anthropic.js";
import { DeepSeekClient } from "./deepseek.js";

// Re-export 类型，方便外部统一从 ai-client 导入
export type { AIClient, AIChatResponse, AIMessage, AIToolCall } from "../types.js";

// Re-export 客户端类（基类 + OpenAI + Anthropic）
export { BaseAIClient, type BaseAIClientOptions, type ChatHandlerParams } from "./custom.js";
export { OpenAIClient, parseOpenAIStream } from "./openai.js";
export { AnthropicClient, parseAnthropicStream } from "./anthropic.js";
export { DeepSeekClient } from "./deepseek.js";

// ─── 公共类型定义 ───

/** AI 客户端配置 */
export type AIClientConfig = {
  /** AI 提供商: "openai" | "copilot" | "anthropic" */
  provider: string;
  /** 模型名称，如 "gpt-4o"、"claude-sonnet-4-20250514" */
  model: string;
  /** API Key / Token */
  apiKey: string;
  /** 自定义 API 基础 URL（可选，如本地 Ollama: http://localhost:11434/v1） */
  baseURL?: string;
};

/** chat 方法的统一入参 */
export type ChatParams = {
  /** 系统提示词 */
  systemPrompt: string;
  /** 对话消息列表 */
  messages: AIMessage[];
  /** 可用工具定义列表 */
  tools?: ToolDefinition[];
};

/**
 * 构建好的 HTTP 请求对象 — 可直接传给 fetch。
 *
 * 被 OpenAIClient / AnthropicClient 内部使用，
 * 也可通过 buildOpenAIRequest() / buildAnthropicRequest() 底层函数获取。
 */
export type ChatRequestInit = {
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: "POST";
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体（JSON 字符串） */
  body: string;
};

// ─── 高层 API ───

/**
 * 创建 AI 客户端（高层 API）。
 *
 * 根据 provider 自动创建对应的客户端类实例：
 * - openai / copilot → new OpenAIClient(config)
 * - anthropic        → new AnthropicClient(config)
 *
 * 返回 AIClient 接口，调用 chat() 即可与 AI 对话。
 *
 * @param config - 包含 provider、model、apiKey 等配置
 * @returns AIClient 实例（OpenAIClient 或 AnthropicClient）
 */
export function createAIClient(config: AIClientConfig): AIClient {
  validateProvider(config.provider);

  switch (config.provider) {
    case "openai":
    case "copilot":
      return new OpenAIClient(config);
    case "anthropic":
      return new AnthropicClient(config);
    case "deepseek":
      return new DeepSeekClient(config);
    default:
      throw new Error(
        `Unknown AI provider: ${config.provider}. Supported: openai, copilot, anthropic, deepseek`,
      );
  }
}
