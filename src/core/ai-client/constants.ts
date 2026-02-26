/**
 * AI Client 常量与共享工具函数。
 *
 * 集中管理各 Provider 的端点映射、Schema 清理等通用逻辑。
 * 被 openai.ts / anthropic.ts / 主入口 ai-client.ts 共同依赖。
 */
import type { AIClientConfig } from "./index.js";

// ─── Provider 端点映射 ───

/**
 * 各 Provider 的默认 API 端点。
 *
 * - openai   → OpenAI 官方 API
 * - copilot  → GitHub Models API（使用 OpenAI 兼容格式）
 * - anthropic → Anthropic Messages API
 */
export const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  copilot: "https://models.inference.ai.azure.com",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
};

// ─── 共享工具函数 ───

/**
 * 校验 provider 是否受支持。
 *
 * @throws 不支持的 provider 抛出 Error，附带支持列表
 */
export function validateProvider(provider: string): void {
  if (!PROVIDER_ENDPOINTS[provider]) {
    const supported = Object.keys(PROVIDER_ENDPOINTS).join(", ");
    throw new Error(
      `Unknown AI provider: ${provider}. Supported: ${supported}`,
    );
  }
}

/**
 * 解析 provider 对应的 API 基础 URL。
 *
 * 优先使用用户自定义的 baseURL（如本地 Ollama），
 * 其次使用 PROVIDER_ENDPOINTS 中的默认值。
 */
export function resolveBaseURL(config: AIClientConfig): string {
  return config.baseURL ?? PROVIDER_ENDPOINTS[config.provider] ?? "";
}

/**
 * 清理 TypeBox Schema — 去除 Symbol 等不可序列化的属性。
 *
 * TypeBox 的 Type.Object() 产物包含 Symbol key（如 [Kind]、[Hint]），
 * 这些 Symbol 在 JSON.stringify 时会被忽略，但某些 AI API 端点
 * 对 JSON Schema 做严格校验时可能报错。
 *
 * 通过 JSON roundtrip（stringify → parse）清理掉所有不可序列化的属性。
 */
export function cleanSchema(schema: unknown): unknown {
  return JSON.parse(JSON.stringify(schema));
}
