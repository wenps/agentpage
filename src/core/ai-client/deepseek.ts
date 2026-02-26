/**
 * DeepSeek AI 客户端。
 *
 * DeepSeek 使用 OpenAI 兼容的 Chat Completions API 格式，
 * 因此直接继承 OpenAIClient，复用请求构建和响应解析逻辑。
 *
 * 差异点（相对于 OpenAI）：
 * - 端点：https://api.deepseek.com（Constants 中配置）
 * - 模型：deepseek-chat（V3）、deepseek-reasoner（R1）等
 * - 认证：Authorization: Bearer <API Key>（与 OpenAI 相同）
 * - tool_calls 格式与 OpenAI 完全一致
 *
 * 继承关系：
 *   BaseAIClient（custom.ts）
 *     └── OpenAIClient（openai.ts）
 *           └── DeepSeekClient（本文件）— 可覆盖默认参数
 *
 * 使用示例：
 * ```ts
 * const client = new DeepSeekClient({
 *   provider: "deepseek",
 *   model: "deepseek-chat",
 *   apiKey: "sk-xxx",
 * });
 * const response = await client.chat({ systemPrompt, messages, tools });
 * ```
 *
 * 参考文档：
 * - Tool Calls: https://api-docs.deepseek.com/zh-cn/guides/tool_calls
 * - Chat API:   https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/
 */
import { OpenAIClient } from "./openai.js";

/**
 * DeepSeek AI 客户端 — 继承 OpenAIClient。
 *
 * DeepSeek API 与 OpenAI Chat Completions API 完全兼容，
 * 包括 tool_calls、function calling、消息格式等。
 *
 * 如需自定义 DeepSeek 特有行为（如 strict 模式、思考模式等），
 * 可在此类中覆盖相关方法。
 */
export class DeepSeekClient extends OpenAIClient {}
