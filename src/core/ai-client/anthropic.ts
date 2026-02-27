/**
 * Anthropic 客户端实现（中）/ Anthropic Messages API client implementation (EN).
 */
import type { AIChatResponse, AIMessage, AIToolCall } from "../types.js";
import type { AIClientConfig, ChatParams, ChatRequestInit } from "./index.js";
import { BaseAIClient } from "./custom.js";
import type { ChatHandlerParams } from "./custom.js";
import { consumeSSEJSON } from "./sse.js";
import { resolveBaseURL, cleanSchema } from "./constants.js";

// ─── Anthropic 原始 API 响应类型 ───

/** Anthropic 文本块（中）/ Anthropic text block (EN). */
type AnthropicTextBlock = {
  type: "text";
  text: string;
};

/** Anthropic 工具调用块（中）/ Anthropic tool_use block (EN). */
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

/** Anthropic 内容块联合类型（中）/ Anthropic content block union (EN). */
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

/** Anthropic 原始响应类型（中）/ Raw Anthropic response type (EN). */
type AnthropicRawResponse = {
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
};

// ─── AnthropicClient 类 ───

/**
 * AnthropicClient 类（中）/ AnthropicClient class (EN).
 */
export class AnthropicClient extends BaseAIClient {
  /** AI 客户端配置（provider / model / apiKey / baseURL） */
  protected config: AIClientConfig;

  constructor(config: AIClientConfig) {
    // 注入 chatHandler — 根据 config.stream 选择流式或 JSON（默认流式）
    super({
      chatHandler: async (params: ChatHandlerParams): Promise<AIChatResponse> => {
        const req = buildAnthropicRequest(this.config, params);
        const useStream = this.config.stream ?? true;

        if (!useStream) {
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
          return parseAnthropicResponse(data);
        }

        // 流式模式：请求体已在 buildAnthropicRequest 中包含 stream 字段
        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`AI API ${res.status}: ${errText.slice(0, 500)}`);
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          return parseAnthropicResponse(data);
        }

        return parseAnthropicStream(res);
      },
    });
    this.config = config;
  }
}

// ─── 底层 API：请求构建 ───

/**
 * 构建 Anthropic 请求（中）/ Build Anthropic Messages API request (EN).
 */
export function buildAnthropicRequest(
  config: AIClientConfig,
  params: ChatParams,
): ChatRequestInit {
  const baseURL = resolveBaseURL(config);
  const { systemPrompt, messages, tools } = params;

  // 转换工具定义为 Anthropic 格式（input_schema 而非 parameters）
  const anthropicTools = tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: cleanSchema(t.schema),
  }));

  // 转换消息为 Anthropic 格式（过滤掉 system 角色消息）
  const anthropicMessages = convertMessages(messages);

  // 构建请求体 — system 作为顶层字段
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.model.includes("opus") ? 16384 : 8192,
    system: systemPrompt,
    messages: anthropicMessages,
  };

  if (config.stream ?? true) {
    body.stream = true;
  }

  if (anthropicTools && anthropicTools.length > 0) {
    body.tools = anthropicTools;
  }

  return {
    url: `${baseURL}/v1/messages`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  };
}

// ─── 响应解析 ───

/**
 * 解析 Anthropic 响应（中）/ Parse raw Anthropic response (EN).
 */
export function parseAnthropicResponse(data: unknown): AIChatResponse {
  const d = data as AnthropicRawResponse;

  // 提取所有文本块，合并为单个字符串
  const text = d.content
    ?.filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // 提取所有工具调用块
  const toolCalls: AIToolCall[] | undefined = d.content
    ?.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));

  return {
    text: text || undefined,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
    usage: d.usage
      ? {
          inputTokens: d.usage.input_tokens,
          outputTokens: d.usage.output_tokens,
        }
      : undefined,
  };
}

// ─── 内部辅助函数 ───

/**
 * 消息格式转换（中）/ Convert unified messages to Anthropic format (EN).
 */
function convertMessages(
  messages: AIMessage[],
): Record<string, unknown>[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool" && Array.isArray(m.content)) {
        // 工具结果 → Anthropic 用 user 角色 + tool_result content block
        return {
          role: "user" as const,
          content: m.content.map((tc) => ({
            type: "tool_result" as const,
            tool_use_id: tc.toolCallId,
            content: tc.result,
          })),
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        // AI 回复含工具调用 → text block + tool_use blocks
        const content: Record<string, unknown>[] = [];
        if (m.content && typeof m.content === "string") {
          content.push({ type: "text", text: m.content });
        }
        for (const tc of m.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        return { role: "assistant" as const, content };
      }
      // 普通消息（user / assistant 纯文本）
      return {
        role: m.role as "user" | "assistant",
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content),
      };
    });
}

// ─── 流式响应解析 ───

/**
 * 解析 Anthropic SSE（中）/ Parse Anthropic SSE stream (EN).
 */
export async function parseAnthropicStream(response: Response): Promise<AIChatResponse> {
  // 回退：无 ReadableStream 支持
  if (!response.body) {
    const data = await response.json();
    return parseAnthropicResponse(data);
  }

  let text = "";
  const toolCalls: AIToolCall[] = [];
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  await consumeSSEJSON(
    response,
    (event) => {
      switch (event.type) {
        case "message_start": {
          const msg = event.message as { usage?: { input_tokens?: number } } | undefined;
          inputTokens = msg?.usage?.input_tokens ?? 0;
          break;
        }

        case "content_block_start": {
          const block = event.content_block as { type: string; id?: string; name?: string } | undefined;
          if (block?.type === "tool_use") {
            currentToolUse = { id: block.id ?? "", name: block.name ?? "", inputJson: "" };
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta as { type: string; text?: string; partial_json?: string } | undefined;
          if (delta?.type === "text_delta") {
            text += delta.text ?? "";
          } else if (delta?.type === "input_json_delta" && currentToolUse) {
            currentToolUse.inputJson += delta.partial_json ?? "";
          }
          break;
        }

        case "content_block_stop":
          if (currentToolUse) {
            try {
              toolCalls.push({
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: JSON.parse(currentToolUse.inputJson || "{}"),
              });
            } catch {
              // 工具参数 JSON 解析失败，跳过
            }
            currentToolUse = null;
          }
          break;

        case "message_delta": {
          const deltaUsage = (event as { usage?: { output_tokens?: number } }).usage;
          outputTokens = deltaUsage?.output_tokens ?? 0;
          break;
        }
      }
    },
    { stopOnDone: false },
  );

  return {
    text: text || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : undefined,
  };
}
