/**
 * AI Client — 基于 fetch 的 AI 客户端。
 *
 * 使用原生 fetch API，浏览器天然支持。
 * 不依赖任何 SDK（@anthropic-ai/sdk、openai），零环境耦合。
 *
 * 支持三种 provider：
 * - "openai"    → OpenAI API (https://api.openai.com/v1)
 * - "copilot"   → GitHub Models API (https://models.inference.ai.azure.com)
 * - "anthropic" → Anthropic API (https://api.anthropic.com)
 *
 * 使用方：
 *   core/ai-client.ts ←── web/index.ts（WebAgent）
 */
import type { AIClient, AIChatResponse, AIToolCall } from "./types.js";

// Re-export 类型，方便外部统一从 ai-client 导入
export type { AIClient, AIChatResponse, AIMessage, AIToolCall } from "./types.js";

// ─── 配置 ───

export type AIClientConfig = {
  /** AI 提供商: "openai" | "copilot" | "anthropic" */
  provider: string;
  /** 模型名称, 如 "gpt-4o", "claude-sonnet-4-20250514" */
  model: string;
  /** API Key / Token */
  apiKey: string;
  /** 自定义 API 基础 URL（可选） */
  baseURL?: string;
};

// ─── 各 Provider 的默认端点 ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API 响应无固定类型
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

const PROVIDER_DEFAULTS: Record<string, { baseURL: string }> = {
  openai: { baseURL: "https://api.openai.com/v1" },
  copilot: { baseURL: "https://models.inference.ai.azure.com" },
  anthropic: { baseURL: "https://api.anthropic.com" },
};

// ─── 工厂函数 ───

/**
 * 创建 AI 客户端（纯 fetch 实现，跨平台）。
 *
 * @param config - 包含 provider、model、apiKey 等配置
 * @returns AIClient 实例，调用 chat() 即可与 AI 对话
 */
export function createAIClient(config: AIClientConfig): AIClient {
  const { provider } = config;

  switch (provider) {
    case "openai":
    case "copilot":
      return createOpenAICompatibleClient(config);
    case "anthropic":
      return createAnthropicClient(config);
    default:
      throw new Error(
        `Unknown AI provider: ${provider}. Supported: openai, copilot, anthropic`,
      );
  }
}

// ─── OpenAI 兼容客户端（OpenAI + GitHub Copilot） ───

/**
 * OpenAI 兼容协议客户端。
 * OpenAI 和 GitHub Copilot (Models API) 使用相同的请求/响应格式。
 */
function createOpenAICompatibleClient(config: AIClientConfig): AIClient {
  const baseURL =
    config.baseURL ?? PROVIDER_DEFAULTS[config.provider]?.baseURL ?? "";

  return {
    async chat({ systemPrompt, messages, tools }): Promise<AIChatResponse> {
      // 转换工具定义为 OpenAI function calling 格式
      const openaiTools = tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: JSON.parse(JSON.stringify(t.schema)), // 清理 TypeBox Symbol
        },
      }));

      // 构建 OpenAI 格式消息数组
      const openaiMessages: Record<string, unknown>[] = [
        { role: "system", content: systemPrompt },
      ];

      for (const m of messages) {
        if (m.role === "tool" && Array.isArray(m.content)) {
          // 工具结果 → 每个结果单独一条 tool 消息
          for (const tc of m.content) {
            openaiMessages.push({
              role: "tool",
              content: tc.result,
              tool_call_id: tc.toolCallId,
            });
          }
        } else if (m.role === "assistant" && m.toolCalls?.length) {
          // AI 回复含工具调用
          openaiMessages.push({
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
          openaiMessages.push({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content),
          });
        }
      }

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

      // 发送请求
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`AI API ${res.status}: ${errText.slice(0, 500)}`);
      }

      const data = await jsonBody(res);
      const choice = data.choices?.[0];
      if (!choice) throw new Error("AI 未返回有效响应");

      const msg = choice.message;

      // 解析工具调用
      const toolCalls: AIToolCall[] | undefined = msg.tool_calls
        ?.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        }));

      return {
        text: msg.content || undefined,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },
  };
}

// ─── Anthropic 客户端 ───

/**
 * Anthropic Claude 客户端。
 * 使用 Anthropic Messages API 格式（与 OpenAI 不同）。
 */
function createAnthropicClient(config: AIClientConfig): AIClient {
  const baseURL = config.baseURL ?? PROVIDER_DEFAULTS.anthropic.baseURL;

  return {
    async chat({ systemPrompt, messages, tools }): Promise<AIChatResponse> {
      // 转换工具定义
      const anthropicTools = tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: JSON.parse(JSON.stringify(t.schema)),
      }));

      // 转换消息格式
      const anthropicMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => {
          if (m.role === "tool" && Array.isArray(m.content)) {
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
          return {
            role: m.role as "user" | "assistant",
            content:
              typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content),
          };
        });

      // 构建请求体
      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: config.model.includes("opus") ? 16384 : 8192,
        system: systemPrompt,
        messages: anthropicMessages,
      };
      if (anthropicTools && anthropicTools.length > 0) {
        body.tools = anthropicTools;
      }

      // 发送请求
      const res = await fetch(`${baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
      }

      const data = await jsonBody(res);

      // 提取文本
      const text = data.content
        ?.filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      // 提取工具调用
      const toolCalls: AIToolCall[] | undefined = data.content
        ?.filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({
          id: b.id,
          name: b.name,
          input: b.input,
        }));

      return {
        text: text || undefined,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
            }
          : undefined,
      };
    },
  };
}
