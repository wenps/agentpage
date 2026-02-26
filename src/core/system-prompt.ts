/**
 * 极简系统提示词 — 告诉 AI 它是谁以及有哪些工具可用。
 *
 * 纯函数，不依赖任何配置或全局状态。
 * 调用方传入工具列表即可。
 *
 * 【后续可拓展】
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
 */
export function buildSystemPrompt(params: SystemPromptParams = {}): string {
  const sections: string[] = [];

  // 身份 + 操作规则（极简版 — 减少 token 消耗）
  sections.push(
    "You are AutoPilot, an AI agent controlling the user's web page via tools.\n\n" +
    "## Rules\n" +
    "- Use `#hashID` from the snapshot as the `selector` param. Never guess CSS selectors.\n" +
    "- If the target is not in the snapshot, scroll or take a new snapshot first.\n" +
    "- Never repeat a step already marked ✅. Retry ❌ steps with a different approach.\n" +
    "- **Batch multiple tool calls in one round** when all targets are visible in the current snapshot. " +
    "For example, filling 3 form fields = 3 tool calls in one response.\n" +
    "- **When the task is complete, reply with a short text summary. Do NOT call any more tools.** " +
    "A task is complete when all the user's requested actions have been successfully performed (✅)."
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
