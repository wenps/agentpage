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
    // 注入 chatHandler — 流式传输，减少首字节延迟，提升响应速度
    super({
      chatHandler: async (params: ChatHandlerParams): Promise<AIChatResponse> => {
        const req = buildOpenAIRequest(this.config, params);

        // 先尝试流式传输（低延迟），失败时自动降级到非流式
        const body = JSON.parse(req.body) as Record<string, unknown>;
        const streamBody: Record<string, unknown> = {
          ...body,
          stream: true,
          stream_options: { include_usage: true },
        };

        const streamRes = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(streamBody),
        });

        if (!streamRes.ok) {
          const errText = await streamRes.text();
          throw new Error(`AI API ${streamRes.status}: ${errText.slice(0, 500)}`);
        }

        const contentType = streamRes.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await streamRes.json();
          return parseOpenAIResponse(data);
        }

        try {
          const parsed = await parseOpenAIStream(streamRes, 20000);
          if (parsed.text || (parsed.toolCalls && parsed.toolCalls.length > 0)) {
            return parsed;
          }
          throw new Error("Empty SSE response");
        } catch {
          const fallbackRes = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: JSON.stringify(body),
          });

          if (!fallbackRes.ok) {
            const errText = await fallbackRes.text();
            throw new Error(`AI API ${fallbackRes.status}: ${errText.slice(0, 500)}`);
          }

          const data = await fallbackRes.json();
          return parseOpenAIResponse(data);
        }
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
    max_tokens: 4096,
  };

  if (openaiTools && openaiTools.length > 0) {
    body.tools = openaiTools;
    body.tool_choice = "auto";
    body.parallel_tool_calls = true;
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

// ─── 流式响应解析 ───

/** SSE 流中 tool_calls delta 的类型 */
type OpenAIStreamToolCallDelta = {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

/** SSE 流中单个 chunk 的类型 */
type OpenAIStreamChunk = {
  choices?: Array<{
    delta: {
      content?: string;
      tool_calls?: OpenAIStreamToolCallDelta[];
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * 从 OpenAI SSE 流解析为统一的 AIChatResponse。
 *
 * 实现原理：
 * - SSE 每行格式：`data: {json}`，结束标志 `data: [DONE]`
 * - 文本内容通过 `delta.content` 跨 chunk 累积
 * - 工具调用通过 `delta.tool_calls[].index` 识别，arguments 跨 chunk 拼接
 * - 用量信息需通过 `stream_options: { include_usage: true }` 请求才会返回
 *
 * 如果 response.body 不可用（极少数环境），自动回退到非流式解析。
 */
export async function parseOpenAIStream(
  response: Response,
  readTimeoutMs = 20000,
): Promise<AIChatResponse> {
  // 回退：无 ReadableStream 支持
  if (!response.body) {
    const data = await response.json();
    return parseOpenAIResponse(data);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let text = "";
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
  let usage: AIChatResponse["usage"];
  let buffer = "";
  let streamDone = false;

  async function readWithTimeout() {
    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSE read timeout (${readTimeoutMs}ms)`));
      }, readTimeoutMs);

      reader.read().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  while (!streamDone) {
    const { done, value } = await readWithTimeout();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 按换行分割，保留不完整的最后一行
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
        streamDone = true;
        break;
      }
      if (!trimmed.startsWith("data:")) continue;

      // 兼容 `data:{...}` 与 `data: {...}` 两种格式
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      try {
        const chunk = JSON.parse(payload) as OpenAIStreamChunk;
        const delta = chunk.choices?.[0]?.delta;

        // 累积文本
        if (delta?.content) text += delta.content;

        // 累积工具调用（按 index 分组）
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallMap.get(idx);
            if (existing) {
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else {
              toolCallMap.set(idx, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              });
            }
          }
        }

        // 用量信息（流式需 stream_options.include_usage）
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
      } catch {
        // 无效 JSON 行，跳过
      }
    }
  }

  if (streamDone) {
    await reader.cancel().catch(() => undefined);
  }

  // 组装工具调用
  const toolCalls: AIToolCall[] = [];
  for (const [, tc] of [...toolCallMap.entries()].sort((a, b) => a[0] - b[0])) {
    try {
      toolCalls.push({ id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) });
    } catch {
      // 工具参数 JSON 解析失败，跳过
    }
  }

  return {
    text: text || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
  };
}
