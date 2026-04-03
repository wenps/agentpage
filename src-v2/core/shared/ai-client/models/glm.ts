/**
 * GLM 客户端封装（中）/ GLM client wrapper (EN).
 *
 * 智谱 AI GLM 系列（GLM-4.5-Air 等）与 OpenAI Chat Completions 兼容，直接复用 OpenAIClient。
 * ZhipuAI GLM models are OpenAI-compatible, so it reuses OpenAIClient behavior.
 *
 * 默认端点：https://open.bigmodel.cn/api/paas/v4
 * 推荐模型：GLM-4.5-Air / GLM-4-Flash / GLM-4-Plus
 */
import { OpenAIClient } from "./openai.js";

/**
 * GLM 客户端类（中）/ GLM client class extending OpenAIClient (EN).
 */
export class GLMClient extends OpenAIClient {}
