/**
 * 极简系统提示词 — 告诉 AI 它是谁以及有哪些工具可用。
 *
 * 纯函数，不依赖任何配置或全局状态。
 * 调用方（node/web）传入工具列表即可。
 *
 * 【后续可拓展】
 * - 添加 Skills 系统（从 ~/.autopilot/skills/ 加载 Markdown 技能文件）
 * - 添加 Runtime 信息段（provider、model、date 等）
 * - 支持 extraInstructions 注入自定义指令
 * - 支持 thinkingLevel 控制思考深度
 */
import type { ToolDefinition } from "./tool-registry.js";

export type SystemPromptParams = {
  /** 已注册的工具列表（由调用方从 ToolRegistry 获取后传入） */
  tools?: ToolDefinition[];
  /** AI 思考深度 */
  thinkingLevel?: string;
};

/**
 * 构建系统提示词。
 * 由两部分组成：身份描述 + 可用工具列表。
 *
 * 不依赖 config — 环境相关配置由 node/web 各自处理。
 */
export function buildSystemPrompt(params: SystemPromptParams = {}): string {
  const sections: string[] = [];

  // 身份
  sections.push(
    "You are AutoPilot, a personal AI automation agent.\n" +
    "You can execute shell commands, read/write files, search the web, and fetch web pages.\n" +
    "Always confirm destructive actions with the user before executing."
  );

  // 工具列表
  const tools = params.tools ?? [];
  if (tools.length > 0) {
    const toolLines = tools.map(t => `- **${t.name}**: ${t.description}`);
    sections.push(
      "## Available Tools\n\n" +
      toolLines.join("\n") + "\n\n" +
      "Use tools when needed to complete the user's request."
    );
  }

  return sections.join("\n\n");
}
