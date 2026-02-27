/**
 * 极简系统提示词构建器（中）/ Minimal system prompt builder (EN).
 *
 * 纯函数，不依赖运行时环境；调用方只需传入工具定义和可选扩展指令。
 * Pure function with no runtime coupling; callers pass tools and optional extra instructions.
 */
import type { ToolDefinition } from "./tool-registry.js";

export type SystemPromptParams = {
  /** 已注册工具列表（中）/ Registered tool definitions (EN). */
  tools?: ToolDefinition[];
  /** AI 思考深度标签（中）/ Optional thinking-level label (EN). */
  thinkingLevel?: string;
  /** 额外英文指令（中）/ Additional English instructions (EN). */
  extraInstructions?: string | string[];
};

/**
 * 规范化额外指令（中）/ Normalize additional instructions (EN).
 */
function normalizeExtraInstructions(input?: string | string[]): string[] {
  if (!input) return [];
  const rawList = Array.isArray(input) ? input : [input];
  return rawList.map(s => s.trim()).filter(Boolean);
}

/**
 * 构建系统提示词（中）/ Build system prompt (EN).
 *
 * 约束：
 * - 输出给模型的提示词正文统一为英文。
 * - 中文仅用于代码注释，便于团队维护。
 *
 * Constraints:
 * - Prompt text sent to model stays English-only.
 * - Chinese content is used in code comments only for maintainability.
 */
export function buildSystemPrompt(params: SystemPromptParams = {}): string {
  const sections: string[] = [];
  const rules: string[] = [];

  // 中文说明：以下规则文本会进入 prompt，因此正文保持英文。
  // 为了便于维护，这里给出逐条中文释义（仅注释，不会进入 prompt payload）。
  // CN note: Prompt payload must stay English-only. Chinese lines below are comments only.
  // 1) 使用快照 hash 作为 selector，不猜 CSS。
  // 2) 目标不在快照时，先滚动或刷新快照。
  // 3) 已完成步骤不重复；失败步骤换方法重试。
  // 4) 禁止调用 page_info；每轮已提供最新快照。
  // 5) 不输出规划过程，只给工具调用并执行。
  // 6) 始终以用户原始请求为主目标。
  // 7) 快照驱动：当前可见目标可同轮批量执行。
  // 8) 下拉框优先用 select_option（或对 select 用 fill），不要只 click。
  // 9) 不跨 DOM 变化链式执行（如先开弹窗再填字段需分轮）。
  // 10) 默认不操作 AutoPilot 自身 UI，除非用户明确要求。
  // 11) 任务完成后给简短总结，不再继续工具调用。
  rules.push(
    "- Use `#hashID` from the snapshot as the `selector` param. Never guess CSS selectors.",
    "- If the target is not in the snapshot, scroll or take a new snapshot first.",
    "- Never repeat a step already marked ✅. Retry ❌ steps with a different approach.",
    "- Do NOT call `page_info` tool (snapshot/query_all/get_url etc.). A fresh snapshot is always provided in each round of conversation — use it directly. Never waste a tool call on page inspection.",
    "- Do not output step-by-step planning text. Just return tool calls and execute.",
    "- Always treat the user's original request as the master goal.",
    "- **Snapshot-driven execution**: Look at the current snapshot and execute ALL sub-tasks whose targets are currently visible. Return multiple tool calls in one round when their targets all exist in the snapshot (e.g. two input fields both visible → fill both).",
    "- For dropdown/select fields, use `dom` with `action=select_option` (or `fill` on a select). Do not rely on click-only selection.",
    "- **Never chain dependent actions across DOM changes**: If action A will cause new elements to appear (e.g. opening a modal), do NOT include actions on those new elements in the same round. They don't exist in the current snapshot yet. Execute A first, then a refreshed snapshot will be provided, and you can act on the new elements next round.",
    "- **Do NOT interact with AutoPilot's own UI** (chat input, send button, shortcut buttons, chat dock). Only operate on the actual page content the user is referring to. Exception: if the user explicitly requests operating AutoPilot UI, follow that request exactly.",
    "- **When the task is complete, reply with a short text summary. Do NOT call any more tools.**",
  );

  const intro = [
    "You are AutoPilot, an AI agent controlling the user's web page via tools.",
    "",
    "## Rules",
    ...rules,
  ];

  sections.push(intro.join("\n"));

  // 工具列表（中）/ Available tool list (EN).
  const tools = params.tools ?? [];
  if (tools.length > 0) {
    const toolLines = tools.map(t => `- **${t.name}**: ${t.description}`);
    sections.push(
      "## Available Tools\n\n" +
      toolLines.join("\n") + "\n\n" +
      "Use tools when needed to complete the user's request."
    );
  }

  // 思考深度（中）/ Thinking-level hint (EN).
  if (params.thinkingLevel) {
    sections.push(
      [
        "## Reasoning Profile",
        `- Thinking level: ${params.thinkingLevel}`,
      ].join("\n"),
    );
  }

  // 额外指令（中）/ Additional custom instructions (EN).
  const extraInstructions = normalizeExtraInstructions(params.extraInstructions);
  if (extraInstructions.length > 0) {
    sections.push(
      [
        "## Extra Instructions",
        ...extraInstructions.map(line => `- ${line}`),
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}
