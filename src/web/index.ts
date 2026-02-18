/**
 * WebAgent — 浏览器端 AI Agent 类。
 *
 * 封装了完整的 Agent 能力，可在浏览器中独立运行：
 * - 对话（chat）   → 发消息、获取 AI 回复
 * - 工具注册       → 注册内置 Web 工具或自定义工具
 * - 决策循环       → 复用 core/agent-loop.ts 的通用逻辑
 * - AI 连接        → 复用 core/ai-client.ts（基于 fetch，跨平台）
 *
 * 使用示例：
 * ```ts
 * const agent = new WebAgent({ token: "ghp_xxx", provider: "copilot" });
 * agent.registerTools();     // 注册内置 Web 工具
 * agent.callbacks.onText = (text) => console.log(text);
 *
 * const result = await agent.chat("获取页面标题");
 * console.log(result.reply);
 * ```
 *
 * 架构位置：
 *   ┌──────────────────────────────────────────────────┐
 *   │  WebAgent（浏览器端入口）                         │
 *   │  ┌──────────┐  ┌────────────┐  ┌──────────────┐ │
 *   │  │ core/    │  │ core/      │  │ web/tools/   │ │
 *   │  │ ai-client│  │ agent-loop │  │ (DOM/导航等) │ │
 *   │  │ (fetch)  │  │ (通用循环) │  │              │ │
 *   │  └──────────┘  └────────────┘  └──────────────┘ │
 *   └──────────────────────────────────────────────────┘
 */
import {
  executeAgentLoop,
  type AgentLoopCallbacks,
  type AgentLoopResult,
} from "../core/agent-loop.js";
import { createAIClient, type AIClientConfig } from "../core/ai-client.js";
import { ToolRegistry, type ToolDefinition } from "../core/tool-registry.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { registerWebTools } from "./tools/register.js";

// ─── 配置 ───

export type WebAgentOptions = {
  /** API 认证 Token (GitHub PAT / OpenAI key / Anthropic key) */
  token: string;
  /** AI 提供商: "copilot" | "openai" | "anthropic"（默认 "copilot"） */
  provider?: string;
  /** 模型名称（默认 "gpt-4o"） */
  model?: string;
  /** 自定义 API 基础 URL（可选，覆盖 provider 默认值） */
  baseURL?: string;
  /** 是否启用干运行模式 */
  dryRun?: boolean;
  /** 自定义系统提示词（不传则使用默认 Web 提示词） */
  systemPrompt?: string;
  /** 最大工具调用轮次（默认 10） */
  maxRounds?: number;
};

// ─── WebAgent 类 ───

export class WebAgent {
  private token: string;
  private provider: string;
  private model: string;
  private baseURL?: string;
  private dryRun: boolean;
  private maxRounds: number;
  private customSystemPrompt?: string;

  /** 工具注册表实例 — 每个 WebAgent 拥有独立的工具集 */
  private registry = new ToolRegistry();

  /** 事件回调 — 绑定后可实时获取 Agent 进度，用于 UI 展示 */
  callbacks: AgentLoopCallbacks = {};

  constructor(options: WebAgentOptions) {
    this.token = options.token;
    this.provider = options.provider ?? "copilot";
    this.model = options.model ?? "gpt-4o";
    this.baseURL = options.baseURL;
    this.dryRun = options.dryRun ?? false;
    this.maxRounds = options.maxRounds ?? 10;
    this.customSystemPrompt = options.systemPrompt;
  }

  // ─── 工具管理 ───

  /** 注册所有内置 Web 工具（dom, navigate, page_info, wait, evaluate） */
  registerTools(): void {
    registerWebTools(this.registry);
  }

  /** 注册一个自定义工具 */
  registerTool(tool: ToolDefinition): void {
    this.registry.register(tool);
  }

  /** 获取所有已注册的工具定义列表 */
  getTools(): ToolDefinition[] {
    return this.registry.getDefinitions();
  }

  // ─── 配置修改 ───

  /** 设置 API Token */
  setToken(token: string): void {
    this.token = token;
  }

  /** 设置 AI 提供商 */
  setProvider(provider: string): void {
    this.provider = provider;
  }

  /** 设置模型 */
  setModel(model: string): void {
    this.model = model;
  }

  /** 切换干运行模式 */
  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  /** 设置自定义系统提示词 */
  setSystemPrompt(prompt: string): void {
    this.customSystemPrompt = prompt;
  }

  // ─── 核心能力 ───

  /**
   * 发送消息并获取 AI 回复（含完整工具调用循环）。
   *
   * 内部流程（全部复用 core）：
   * 1. createAIClient() → 创建 fetch AI 客户端
   * 2. buildSystemPrompt() → 构建系统提示词
   * 3. executeAgentLoop() → 执行决策循环
   * 4. callbacks → 实时通知 UI
   */
  async chat(message: string): Promise<AgentLoopResult> {
    if (!this.token) {
      throw new Error("未设置 Token，请先调用 setToken()");
    }

    // 复用 core/ai-client — 同一份 fetch 实现
    const client = createAIClient({
      provider: this.provider,
      model: this.model,
      apiKey: this.token,
      baseURL: this.baseURL,
    });

    // 复用 core/system-prompt 或使用自定义
    const systemPrompt =
      this.customSystemPrompt ??
      buildSystemPrompt({ tools: this.registry.getDefinitions() });

    // 复用 core/agent-loop — 同一份决策循环
    return executeAgentLoop({
      client,
      registry: this.registry,
      systemPrompt,
      message,
      dryRun: this.dryRun,
      maxRounds: this.maxRounds,
      callbacks: this.callbacks,
    });
  }
}
