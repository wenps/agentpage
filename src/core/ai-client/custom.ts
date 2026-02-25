/**
 * BaseAIClient — 可继承的 AI 客户端基类。
 *
 * 提供 `AIClient` 接口的类实现，用户可以：
 * 1. 直接实例化 — 传入自定义 `chatHandler` 回调，完全控制对话逻辑
 * 2. 继承扩展 — 覆盖 `chat()` 方法，实现自定义 AI 对接
 *
 * 使用场景：
 * - 对接非标准 AI API（如私有部署的模型服务）
 * - 添加请求拦截（日志、重试、缓存、限流等中间件逻辑）
 * - 对接本地模型（Ollama、llama.cpp 等）
 * - 测试 Mock（注入固定响应进行单元测试）
 *
 * 使用示例：
 *
 * ```ts
 * // 方式一：直接实例化 + chatHandler
 * const client = new BaseAIClient({
 *   chatHandler: async (params) => {
 *     const res = await fetch("https://my-api.com/chat", {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify(params),
 *     });
 *     const data = await res.json();
 *     return { text: data.reply };
 *   },
 * });
 *
 * // 方式二：继承扩展
 * class MyAIClient extends BaseAIClient {
 *   async chat(params) {
 *     // 添加自定义逻辑（日志、重试等）
 *     console.log("Sending:", params.messages.length, "messages");
 *     const response = await super.chat(params);
 *     console.log("Received:", response.text?.length, "chars");
 *     return response;
 *   }
 * }
 *
 * // 传入 WebAgent
 * const agent = new WebAgent({ client: new MyAIClient({ chatHandler }) });
 * ```
 *
 * 文件位置：
 *   ai-client/custom.ts ←── ai-client/index.ts（re-export）
 *                        ←── web/index.ts（WebAgent 接受 client 选项）
 */
import type { AIChatResponse, AIClient, AIMessage } from "../types.js";
import type { ToolDefinition } from "../tool-registry.js";

// ─── 类型定义 ───

/** chat 方法的入参（与 AIClient.chat 签名一致） */
export type ChatHandlerParams = {
  /** 系统提示词 */
  systemPrompt: string;
  /** 对话消息列表 */
  messages: AIMessage[];
  /** 可用工具定义列表 */
  tools?: ToolDefinition[];
};

/**
 * BaseAIClient 构造选项。
 *
 * `chatHandler` 是核心 — 用户提供的对话处理函数。
 * 它接收统一格式的入参，返回统一格式的 AIChatResponse。
 */
export type BaseAIClientOptions = {
  /** 对话处理函数 — 接收 ChatHandlerParams，返回 AIChatResponse */
  chatHandler: (params: ChatHandlerParams) => Promise<AIChatResponse>;
};

// ─── BaseAIClient 类 ───

/**
 * 可继承的 AI 客户端基类 — 实现 AIClient 接口。
 *
 * 设计原则：
 * - 实现 `AIClient` 接口 → 可直接传入 `executeAgentLoop()` 和 `WebAgent`
 * - 构造时注入 `chatHandler` → 无需继承即可自定义对话逻辑
 * - `chat()` 方法可被子类覆盖 → 支持继承式扩展（添加中间件逻辑）
 */
export class BaseAIClient implements AIClient {
  /** 用户提供的对话处理函数 */
  protected chatHandler: (params: ChatHandlerParams) => Promise<AIChatResponse>;

  constructor(options: BaseAIClientOptions) {
    this.chatHandler = options.chatHandler;
  }

  /**
   * 发送对话请求并获取 AI 响应。
   *
   * 默认实现直接委托给 `chatHandler`。
   * 子类可覆盖此方法添加中间件逻辑（日志、重试、缓存等）。
   *
   * @param params - 统一格式的聊天参数
   * @returns 统一格式的 AI 响应
   */
  async chat(params: ChatHandlerParams): Promise<AIChatResponse> {
    return this.chatHandler(params);
  }
}
