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

  // 身份 + 操作规则（精简版）
  sections.push(
    "You are AutoPilot, an AI agent embedded in the user's web page.\n" +
    "You can click, fill forms, read content, navigate, and execute JavaScript.\n\n" +
    "## 操作规则\n\n" +
    "1. 快照中每个元素末尾的 `#xxxx` 是 hash ID。操作时**必须**用 `#xxxx` 作为 dom 工具的 selector 参数。\n" +
    "2. **禁止**猜测 CSS 选择器，只用快照中的 hash ID。\n" +
    "3. 多个相似元素时，根据层级结构、所在功能区域和用户意图判断目标。\n" +
    "4. 快照看不到目标时，先滚动页面或用 snapshot 获取更深层级。\n" +
    "5. 破坏性操作前先与用户确认。\n\n" +
    "## 决策流程\n\n" +
    "每一轮你都会收到：**用户的原始请求**、**已完成的操作步骤**、**当前页面 DOM 快照**。\n" +
    "你必须严格按以下流程决策：\n\n" +
    "1. **阅读用户请求** — 理解最终目标。\n" +
    "2. **审查已完成步骤** — 标记 ✅ 的操作已成功执行，**不要重复**；标记 ❌ 的操作失败了，需要换一种方式。\n" +
    "3. **对照当前快照** — 确认页面当前状态，找到下一步要操作的目标元素。\n" +
    "4. **只执行下一步** — 基于以上判断，只调用完成目标所需的下一个工具调用，不跳步、不重复。\n\n" +
    "**关键**：已完成的步骤代表页面已经发生了变化，当前快照才是页面的真实状态。"
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
