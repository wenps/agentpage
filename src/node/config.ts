/**
 * 极简配置 — 只保留 AI 连接必需的字段。
 * API Key 优先从环境变量读取，也支持配置文件覆盖。
 *
 * 【后续可拓展】
 * - 添加 browser / vscode / channels 等配置段
 * - 支持 JSON5 格式配置文件（~/.autopilot/autopilot.json）
 * - 添加 writeConfig() 写入配置
 * - 添加 resolveConfigDir() / resolveConfigPath() 路径函数
 */

export interface AutoPilotConfig {
  agent?: {
    /** AI provider: "anthropic" | "openai" | "copilot" */
    provider?: string;
    /** Model ID, e.g. "claude-opus-4-6", "gpt-4o" */
    model?: string;
    /** API key override (prefer env var) */
    apiKey?: string;
    /**
     * 自定义 API 基础 URL（用于 GitHub Copilot、Azure OpenAI 等兼容端点）。
     * Copilot 默认: https://api.githubcopilot.com
     */
    baseURL?: string;
  };
  browser?: {
    /** 是否无头模式运行（默认 false，可看到浏览器窗口） */
    headless?: boolean;
    /** 自定义 Chromium 可执行文件路径 */
    executablePath?: string;
  };
}

/**
 * 加载配置 — 当前直接返回空对象，API Key 从环境变量获取。
 *
 * 【后续可拓展】读取 ~/.autopilot/autopilot.json 配置文件
 */
export function loadConfig(): AutoPilotConfig {
  return {};
}
