/**
 * Anthropic Messages API 客户端。
 *
 * Anthropic 使用与 OpenAI 完全不同的 API 格式：
 * - system prompt 通过 body.system 字段传入（不在消息数组中）
 * - 工具调用使用 content block 机制（tool_use / tool_result）
 * - 工具结果作为 user 角色消息发送（而非 tool 角色）
 * - API 版本通过 `anthropic-version` 请求头指定
 *
 * 提供两层能力：
 * - 类：AnthropicClient（继承 BaseAIClient）— 封装完整 fetch 流程
 * - 函数：buildAnthropicRequest / parseAnthropicResponse — 底层格式转换
 *
 * 继承关系：
 *   BaseAIClient（custom.ts）
 *     └── AnthropicClient（本文件）— 覆盖 chat()，内部调用 build → fetch → parse
 *
 * 使用方：
 *   ai-client/anthropic.ts ←── ai-client/index.ts（主入口）
 */
import type { AIChatResponse, AIMessage, AIToolCall } from "../types.js";
import type { AIClientConfig, ChatParams, ChatRequestInit } from "./index.js";
import { BaseAIClient } from "./custom.js";
import type { ChatHandlerParams } from "./custom.js";
import { resolveBaseURL, cleanSchema } from "./constants.js";

// ─── Anthropic 原始 API 响应类型 ───

/** Anthropic 文本内容块 */
type AnthropicTextBlock = {
  type: "text";
  text: string;
};

/** Anthropic 工具调用内容块 */
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

/** Anthropic content 数组中的元素（文本 或 工具调用） */
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

/** Anthropic Messages API 的原始 JSON 响应 */
type AnthropicRawResponse = {
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
};

// ─── AnthropicClient 类 ───

/**
 * Anthropic AI 客户端 — 继承 BaseAIClient。
 *
 * 封装完整的 Anthropic Messages API 调用流程：
 * 1. buildAnthropicRequest() → 构建 HTTP 请求
 * 2. fetch() → 发送请求
 * 3. parseAnthropicResponse() → 解析响应为统一格式
 *
 * 使用示例：
 * ```ts
 * const client = new AnthropicClient({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 *   apiKey: "sk-ant-xxx",
 * });
 * const response = await client.chat({ systemPrompt, messages, tools });
 * ```
 */
export class AnthropicClient extends BaseAIClient {
  /** AI 客户端配置（provider / model / apiKey / baseURL） */
  protected config: AIClientConfig;

  constructor(config: AIClientConfig) {
    // 注入 chatHandler — 流式传输，减少首字节延迟，提升响应速度
    super({
      chatHandler: async (params: ChatHandlerParams): Promise<AIChatResponse> => {
        const req = buildAnthropicRequest(this.config, params);

        // 启用流式传输 — 边生成边接收，避免等待完整响应
        const body = JSON.parse(req.body) as Record<string, unknown>;
        body.stream = true;

        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`AI API ${res.status}: ${errText.slice(0, 500)}`);
        }

        return parseAnthropicStream(res);
      },
    });
    this.config = config;
  }
}

// ─── 底层 API：请求构建 ───

/**
 * 将统一格式的 ChatParams 转换为 Anthropic Messages API 请求。
 *
 * 关键格式差异（与 OpenAI 相比）：
 * - system prompt → body.system 字段（非消息数组元素）
 * - 工具定义 → input_schema（而非 parameters）
 * - 工具结果 → user 角色 + tool_result content block
 * - AI 工具调用 → assistant 角色 + tool_use content block
 *
 * max_tokens 策略：opus 模型 16384，其他模型 8192。
 * 认证头使用 `x-api-key`（而非 Authorization Bearer）。
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
 * 将 Anthropic Messages API 原始响应解析为统一的 AIChatResponse。
 *
 * Anthropic 使用 content block 数组返回多种内容：
 * - type="text"     → 文本回复（可能多个，合并为一个字符串）
 * - type="tool_use" → 工具调用（id + name + input）
 *
 * Token 用量字段名也不同：input_tokens / output_tokens（非 prompt_tokens）。
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
 * 将统一消息格式转换为 Anthropic 消息数组。
 *
 * 关键差异处理：
 * 1. 过滤 system 消息（Anthropic 通过 body.system 传入）
 * 2. tool 角色消息 → user 角色 + tool_result content block
 * 3. assistant 含 toolCalls → text + tool_use content blocks
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
 * 从 Anthropic SSE 流解析为统一的 AIChatResponse。
 *
 * Anthropic 流式事件类型：
 * - message_start       → 消息骨架 + input_tokens
 * - content_block_start  → 新内容块（text 或 tool_use）
 * - content_block_delta  → 增量内容（text_delta 或 input_json_delta）
 * - content_block_stop   → 内容块结束
 * - message_delta        → output_tokens + stop_reason
 * - message_stop         → 消息结束
 *
 * 如果 response.body 不可用，自动回退到非流式解析。
 */
export async function parseAnthropicStream(response: Response): Promise<AIChatResponse> {
  // 回退：无 ReadableStream 支持
  if (!response.body) {
    const data = await response.json();
    return parseAnthropicResponse(data);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let text = "";
  const toolCalls: AIToolCall[] = [];
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过空行、注释行、event 行（只处理 data 行）
      if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const event = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;

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
      } catch {
        // 无效 JSON 行，跳过
      }
    }
  }

  return {
    text: text || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : undefined,
  };
}
