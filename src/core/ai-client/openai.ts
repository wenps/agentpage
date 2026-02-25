/**
 * OpenAI / Copilot（GitHub Models）AI 客户端。
 *
 * OpenAI 和 Copilot 使用相同的 API 格式（Chat Completions API），
 * 区别仅在端点 URL 和认证方式：
 * - OpenAI   → https://api.openai.com/v1/chat/completions + Bearer <API Key>
 * - Copilot  → https://models.inference.ai.azure.com/chat/completions + Bearer <GitHub PAT>
 *
 * 提供两层能力：
 * - 类：OpenAIClient（继承 BaseAIClient）— 封装完整 fetch 流程
 * - 函数：buildOpenAIRequest / parseOpenAIResponse — 底层格式转换
 *
 * 继承关系：
 *   BaseAIClient（custom.ts）
 *     └── OpenAIClient（本文件）— 覆盖 chat()，内部调用 build → fetch → parse
 *
 * 使用方：
 *   ai-client/openai.ts ←── ai-client/index.ts（主入口）
 */
import type { AIChatResponse, AIMessage, AIToolCall } from "../types.js";
import type { AIClientConfig, ChatParams, ChatRequestInit } from "./index.js";
import { BaseAIClient } from "./custom.js";
import type { ChatHandlerParams } from "./custom.js";
import { resolveBaseURL, cleanSchema } from "./constants.js";

// ─── OpenAI 原始 API 响应类型 ───

/** OpenAI tool_calls 中单个工具调用的原始格式 */
type OpenAIRawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** OpenAI Chat Completions API 的原始 JSON 响应 */
type OpenAIRawResponse = {
  choices?: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAIRawToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

// ─── OpenAIClient 类 ───

/**
 * OpenAI / Copilot AI 客户端 — 继承 BaseAIClient。
 *
 * 封装完整的 OpenAI Chat Completions API 调用流程：
 * 1. buildOpenAIRequest() → 构建 HTTP 请求
 * 2. fetch() → 发送请求
 * 3. parseOpenAIResponse() → 解析响应为统一格式
 *
 * 使用示例：
 * ```ts
 * const client = new OpenAIClient({
 *   provider: "openai",
 *   model: "gpt-4o",
 *   apiKey: "sk-xxx",
 * });
 * const response = await client.chat({ systemPrompt, messages, tools });
 * ```
 *
 * 也可用于 Copilot（GitHub Models）：
 * ```ts
 * const client = new OpenAIClient({
 *   provider: "copilot",
 *   model: "gpt-4o",
 *   apiKey: "ghp_xxx",
 * });
 * ```
 */
export class OpenAIClient extends BaseAIClient {
  /** AI 客户端配置（provider / model / apiKey / baseURL） */
  protected config: AIClientConfig;

  constructor(config: AIClientConfig) {
    // 注入 chatHandler — 实现 buildRequest → fetch → parseResponse 的完整流程
    super({
      chatHandler: async (params: ChatHandlerParams): Promise<AIChatResponse> => {
        const req = buildOpenAIRequest(this.config, params);

        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`AI API ${res.status}: ${errText.slice(0, 500)}`);
        }

        const data = await res.json();
        return parseOpenAIResponse(data);
      },
    });
    this.config = config;
  }
}

// ─── 底层 API：请求构建 ───

/**
 * 将统一格式的 ChatParams 转换为 OpenAI Chat Completions API 请求。
 *
 * 转换逻辑：
 * - system prompt → `{ role: "system", content }` 消息
 * - 工具定义 → `tools` 数组（function calling 格式）
 * - 工具结果 → 拆分为多条 `{ role: "tool", tool_call_id }` 消息
 * - AI 回复含工具调用 → `tool_calls` 字段
 *
 * 默认参数：temperature=0.3, max_tokens=8192, tool_choice="auto"
 */
export function buildOpenAIRequest(
  config: AIClientConfig,
  params: ChatParams,
): ChatRequestInit {
  const baseURL = resolveBaseURL(config);
  const { systemPrompt, messages, tools } = params;

  // 转换工具定义为 OpenAI function calling 格式
  const openaiTools = tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: cleanSchema(t.schema),
    },
  }));

  // 转换消息为 OpenAI 格式
  const openaiMessages = convertMessages(systemPrompt, messages);

  // 构建请求体
  const body: Record<string, unknown> = {
    model: config.model,
    messages: openaiMessages,
    temperature: 0.3,
    max_tokens: 8192,
  };

  if (openaiTools && openaiTools.length > 0) {
    body.tools = openaiTools;
    body.tool_choice = "auto";
  }

  return {
    url: `${baseURL}/chat/completions`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

// ─── 响应解析 ───

/**
 * 将 OpenAI Chat Completions API 原始响应解析为统一的 AIChatResponse。
 *
 * 解析要点：
 * - 文本回复 → `choice.message.content`
 * - 工具调用 → `choice.message.tool_calls`，arguments 为 JSON 字符串需 parse
 * - Token 用量 → `usage.prompt_tokens` / `usage.completion_tokens`
 *
 * @throws 无有效 choice 时抛出 Error
 */
export function parseOpenAIResponse(data: unknown): AIChatResponse {
  const d = data as OpenAIRawResponse;
  const choice = d.choices?.[0];
  if (!choice) throw new Error("AI 未返回有效响应");

  const msg = choice.message;

  // 解析工具调用：arguments 是 JSON 字符串，需要 parse 为对象
  const toolCalls: AIToolCall[] | undefined = msg.tool_calls?.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments),
  }));

  return {
    text: msg.content || undefined,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
    usage: d.usage
      ? {
          inputTokens: d.usage.prompt_tokens ?? 0,
          outputTokens: d.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

// ─── 内部辅助函数 ───

/**
 * 将统一消息格式转换为 OpenAI 消息数组。
 *
 * 三种特殊消息的处理：
 * 1. tool 消息（工具结果）→ 每个结果拆分为单独的 `role: "tool"` 消息
 * 2. assistant 含 toolCalls → 附带 `tool_calls` 字段
 * 3. 其他消息 → 直接映射 role + content
 */
function convertMessages(
  systemPrompt: string,
  messages: AIMessage[],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const m of messages) {
    if (m.role === "tool" && Array.isArray(m.content)) {
      // 工具结果 → 每个结果单独一条 tool 消息（OpenAI 要求按 tool_call_id 对应）
      for (const tc of m.content) {
        result.push({
          role: "tool",
          content: tc.result,
          tool_call_id: tc.toolCallId,
        });
      }
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      // AI 回复含工具调用 → 带 tool_calls 字段
      result.push({
        role: "assistant",
        content: typeof m.content === "string" ? m.content : null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        })),
      });
    } else {
      // 普通消息（user / assistant 纯文本）
      result.push({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content),
      });
    }
  }

  return result;
}
