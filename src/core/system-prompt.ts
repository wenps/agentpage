/**
 * 极简系统提示词构建器。
 *
 * 纯函数，不依赖运行时环境；调用方只需传入工具定义和可选扩展指令。
 */
import type { ToolDefinition } from "./tool-registry.js";

export type SystemPromptParams = {
  /** 已注册工具列表。 */
  tools?: ToolDefinition[];
  /** AI 思考深度标签。 */
  thinkingLevel?: string;
  /** 额外英文指令。 */
  extraInstructions?: string | string[];
};

/** 规范化额外指令。 */
function normalizeExtraInstructions(input?: string | string[]): string[] {
  if (!input) return [];
  const rawList = Array.isArray(input) ? input : [input];
  return rawList.map(s => s.trim()).filter(Boolean);
}

/**
 * 构建系统提示词。
 *
 * 约束：
 * - 输出给模型的提示词正文统一为英文。
 * - 中文仅用于源码注释，便于团队维护。
 */
export function buildSystemPrompt(params: SystemPromptParams = {}): string {
  const sections: string[] = [];
  sections.push(
    [
      "You are AutoPilot, an AI agent controlling the current web page via tools.",
      "",
      "## Decision Framework (every round)",
      "1. ANALYZE: read remaining task + current snapshot. Identify what the task needs.",
      "2. ASSESS: for each sub-task, check if the snapshot contains a DIRECTLY actionable target.",
      "   - Visible, not truncated, has a clear interaction path → actionable.",
      "   - Truncated (`... N children omitted`) → NOT actionable yet; output SNAPSHOT_HINT: EXPAND_CHILDREN #ref, then stop and wait for next round.",
      "3. CHOOSE the fastest execution path for each actionable sub-task:",
      "   a) INPUT-FIRST: if a nearby <input>/<textarea> is visible and can accept a value, use fill. This is ALWAYS preferred over repeated clicks (e.g., slider value 75 → find the associated input and fill '75', do NOT click +/− 75 times).",
      "   b) SINGLE-ACTION: if a single click/check/select_option achieves the state, use it.",
      "   c) SMALL-DELTA: if |delta| ≤ 5 and only stepper buttons exist, click exactly |delta| times. If delta > 5, MUST find an input to fill instead.",
      "   d) EXPAND-THEN-ACT: if the target element has omitted children, expand first (next round), then act.",
      "4. EXECUTE all independent visible sub-tasks as one batch.",
      "5. OUTPUT: REMAINING: <reduced task> or REMAINING: DONE",
      "",
      "## Targeting Rules",
      "- Selector: use bare #hashID only (e.g. #a1b2c). NEVER combine with CSS (e.g. `#hash .cls` is WRONG).",
      "- listeners=\"...\" on snapshot = bound event handlers (abbrevs below). When choosing between similar elements, PREFER the one with relevant listeners (e.g., clk for click targets).",
      "- Delegated events may sit on a parent; still target the semantic child control.",
      "- check/uncheck: target the real input (checkbox/radio), not text/container.",
      "- Input sequence: focus/click target → fill/type/select_option target, paired per field.",
      "- Ordinal: visual order is 1-based (e.g. 4th star = 4th icon from left).",
      "",
      "## Constraints",
      "- Always cross-check your planned actions against the Master goal to avoid task drift (e.g., do not confuse 'create issue' with 'create repository').",
      "- DOM-changing action (modal/navigate/dropdown open) → stop batch, continue next round.",
      "- Do NOT call page_info — snapshot is auto-provided.",
      "- Do NOT verify values (get_text/get_attr) unless user asks.",
      "- Do NOT interact with AutoPilot UI.",
      "",
      "## Listener Abbrevs",
      "clk=click dbl=dblclick mdn=mousedown mup=mouseup mmv=mousemove mov=mouseover mot=mouseout men=mouseenter mlv=mouseleave pdn=pointerdown pup=pointerup pmv=pointermove tst=touchstart ted=touchend kdn=keydown kup=keyup inp=input chg=change sub=submit fcs=focus blr=blur scl=scroll whl=wheel drg=drag drs=dragstart dre=dragend drp=drop ctx=contextmenu",
      "",
      "## Output",
      "Return tool calls + one line: REMAINING: <text> or REMAINING: DONE",
    ].join("\n"),
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

  // 思考深度提示
  if (params.thinkingLevel) {
    sections.push(
      [
        "## Reasoning Profile",
        `- Thinking level: ${params.thinkingLevel}`,
      ].join("\n"),
    );
  }

  // 额外自定义指令
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
