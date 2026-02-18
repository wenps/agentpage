/**
 * Node Agent — Node 端入口模块。
 *
 * 职责：
 * 1. 注册 Node 内置工具（exec、browser、file 等）
 * 2. 从环境变量解析 API Key
 * 3. 创建 AI 客户端（复用 core/ai-client.ts）
 * 4. 构建系统提示词（复用 core/system-prompt.ts）
 * 5. 调用通用决策循环（复用 core/agent-loop.ts）
 *
 * 导出 runAgent() 供 CLI interactive 使用。
 */
import type { AutoPilotConfig } from "./config.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { createAIClient } from "../core/ai-client.js";
import { executeAgentLoop } from "../core/agent-loop.js";
import { ToolRegistry } from "../core/tool-registry.js";
import { registerBuiltinTools } from "./tools/index.js";

// ─── 默认值 ───

/** 默认 AI 提供商 */
export const DEFAULT_PROVIDER = "copilot";
/** 默认模型（GitHub Models 可用：gpt-4o, gpt-4o-mini, o3-mini） */
export const DEFAULT_MODEL = "gpt-4o";
/** 默认上下文窗口大小（token 数） */
export const DEFAULT_CONTEXT_TOKENS = 200_000;

/**
 * Agent 运行参数 — 调用 runAgent() 时传入。
 */
export type AgentRunParams = {
  /** 用户发送的自然语言消息 */
  message: string;
  /** AI 思考深度: off | low | medium | high */
  thinkingLevel?: string;
  /** 模型 ID 覆盖，如 "gpt-4o" */
  model?: string;
  /** AI 提供商: "anthropic" | "openai" | "copilot" */
  provider: string;
  /** 完整配置对象 */
  config: AutoPilotConfig;
  /** 干运行模式：AI 请求调用工具时只打印配置，不实际执行 */
  dryRun?: boolean;
};

/**
 * Agent 运行结果 — runAgent() 的返回值。
 */
export type AgentRunResult = {
  /** AI 的最终文本回复 */
  reply: string;
  /** 所有工具调用记录（名称、输入参数、执行结果） */
  toolCalls: Array<{ name: string; input: unknown; result: import("../core/tool-registry.js").ToolCallResult }>;
  /** 实际使用的模型 ID */
  model: string;
  /** 总消耗 token 数（如可获取） */
  tokensUsed?: number;
};

/**
 * 运行 Agent（Node 端入口）。
 *
 * 职责：
 * 1. 注册 Node 内置工具（幂等）
 * 2. 创建 SDK AI 客户端
 * 3. 构建系统提示词
 * 4. 委托 executeAgentLoop() 执行核心循环
 */
export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const { message, thinkingLevel, model, provider, config, dryRun } = params;

  // 步骤 1：创建独立的工具注册表并注册内置工具
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);

  // 步骤 2：解析 API Key（Node 端从环境变量获取）
  const resolvedModel = model ?? DEFAULT_MODEL;
  const resolvedProvider = provider ?? DEFAULT_PROVIDER;
  const apiKey = resolveApiKey(resolvedProvider, config);

  // 步骤 3：创建 AI 客户端（纯 fetch，复用 core）
  const client = createAIClient({
    provider: resolvedProvider,
    model: resolvedModel,
    apiKey,
    baseURL: config.agent?.baseURL,
  });

  // 步骤 4：构建系统提示词
  const systemPrompt = buildSystemPrompt({
    tools: registry.getDefinitions(),
    thinkingLevel,
  });

  // 步骤 5：委托通用 Agent 循环执行
  const result = await executeAgentLoop({
    client,
    registry,
    systemPrompt,
    message,
    dryRun,
  });

  return {
    reply: result.reply,
    toolCalls: result.toolCalls,
    model: resolvedModel,
  };
}

// ─── 内部辅助 ───

/** 根据 provider 从配置或环境变量解析 API Key */
function resolveApiKey(provider: string, config: AutoPilotConfig): string {
  // 配置文件优先
  if (config.agent?.apiKey) return config.agent.apiKey;

  // 环境变量兜底
  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    copilot: "GITHUB_TOKEN",
  };
  const envName = envMap[provider] ?? `${provider.toUpperCase()}_API_KEY`;
  const key = process.env[envName];

  if (!key) {
    throw new Error(
      `Missing API key for "${provider}" provider.\n` +
      `Set via: export ${envName}="your_key_here"`,
    );
  }
  return key;
}
