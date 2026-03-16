/**
 * 任务分解执行入口 — executeDecomposition()
 *
 * 完整流程：
 * 1. 发起规划 AI 调用（独立 prompt，不带 tools）→ 拿到 SubTask[]
 * 2. 两阶段执行：直投批量 + 微循环逐个
 * 3. 汇总结果，返回 DecompositionResult（作为 tool result 回传主循环）
 *
 * 被主循环 index.ts 在遇到 `plan_and_execute` 工具调用时调用。
 * 执行期间阻塞主循环（分解完成后主循环才继续下一轮）。
 */

import type { AIClient } from "../../types.js";
import type {
  SubTask,
  DecompositionResult,
  DecompositionContext,
} from "./types.js";
import { buildPlanningSystemPrompt, buildPlanningUserMessage } from "./prompt.js";
import { executeSubTasks } from "./executor.js";

// ─── 导出类型 ───
export type { SubTask, DecompositionResult, DecompositionContext } from "./types.js";

/**
 * 执行任务分解。
 *
 * 主入口函数，被主循环在识别到 plan_and_execute 工具调用时调用。
 *
 * @param goal - 当前页面的高层目标（AI 传入的 goal 参数）
 * @param hints - 可选策略提示（AI 传入的 hints 参数）
 * @param ctx - 分解执行上下文（从主循环透传）
 * @returns DecompositionResult — 包含子任务执行汇总
 */
export async function executeDecomposition(
  goal: string,
  hints: string | undefined,
  ctx: DecompositionContext,
): Promise<DecompositionResult> {
  // ─── Phase 0：规划（AI 分析快照 → 子任务列表）───
  const subTasks = await planSubTasks(ctx.client, goal, hints, ctx.pageContext.latestSnapshot || "");

  if (subTasks.length === 0) {
    return {
      total: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      details: [],
      summary: "No sub-tasks identified by planner.",
    };
  }

  // 通知 UI：规划完成，展示子任务列表
  ctx.callbacks?.onText?.(
    `📋 Task decomposition: ${subTasks.length} sub-tasks planned\n` +
    subTasks.map(t =>
      `  ${t.id}. [${t.directExecutable ? "direct" : "loop"}] ${t.description}`,
    ).join("\n"),
  );

  // ─── Phase 1 + 2：执行（直投批量 + 微循环）───
  const results = await executeSubTasks(subTasks, ctx);

  // ─── 汇总 ───
  const done = results.filter(r => r.status === "done").length;
  const failed = results.filter(r => r.status === "failed").length;
  const skipped = results.filter(r => r.status === "skipped").length;

  const detailLines = results.map(r => {
    const icon = r.status === "done" ? "✅" : r.status === "failed" ? "❌" : "⏭️";
    const reason = r.failReason ? ` — ${r.failReason}` : "";
    return `${icon} ${r.subTaskId}. ${r.description}${reason}`;
  });

  const summary = [
    `Task decomposition completed: ${done}/${results.length} sub-tasks done.`,
    ...detailLines,
  ].join("\n");

  return {
    total: results.length,
    done,
    failed,
    skipped,
    details: results,
    summary,
  };
}

// ─── 内部：规划 AI 调用 ───

/**
 * 调用 AI 规划子任务列表。
 *
 * 独立 AI 请求：专用 system prompt + 不传 tools。
 * 解析 AI 返回的 JSON 数组为 SubTask[]。
 */
async function planSubTasks(
  client: AIClient,
  goal: string,
  hints: string | undefined,
  snapshot: string,
): Promise<SubTask[]> {
  const systemPrompt = buildPlanningSystemPrompt();
  const userMessage = buildPlanningUserMessage(goal, snapshot, hints);

  try {
    const response = await client.chat({
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      // 不传 tools — 规划 AI 只输出 JSON，不需要工具调用能力
    });

    const rawText = response.text ?? "";
    return parsePlanResponse(rawText);
  } catch {
    // 规划 AI 失败：返回空列表，主循环会收到 "0 sub-tasks" 结果
    return [];
  }
}

/**
 * 解析规划 AI 返回的 JSON 子任务列表。
 *
 * 容错：
 * - 支持 markdown code fences 包裹
 * - 支持 <think> 标签（DeepSeek 等模型）
 * - 非数组或解析失败返回空数组
 */
function parsePlanResponse(rawText: string): SubTask[] {
  // 剥离 <think>...</think>
  const stripped = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // 剥离 markdown code fences
  const jsonText = stripped
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: unknown): item is Record<string, unknown> =>
        item !== null && typeof item === "object",
      )
      .map((item, index) => ({
        id: typeof item.id === "number" ? item.id : index + 1,
        action: String(item.action || "click"),
        target: String(item.target || ""),
        value: item.value !== undefined ? String(item.value) : undefined,
        description: String(item.description || `Sub-task ${index + 1}`),
        directExecutable: Boolean(item.directExecutable),
      }));
  } catch {
    return [];
  }
}
