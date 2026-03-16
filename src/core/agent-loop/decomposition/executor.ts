/**
 * 任务分解执行引擎。
 *
 * 两阶段执行策略：
 *
 * Phase 1 — 直投批量执行（Direct Batch）：
 *   - 将所有 directExecutable=true 的子任务（fill/check/type/select_option）
 *     直接构造 tool call 批量执行，跳过 AI 调用。
 *   - 非 DOM 变更操作可在同一轮全部执行。
 *   - 直投失败的子任务回退到 Phase 2。
 *
 * Phase 2 — 微循环逐个执行（Micro Loop）：
 *   - 对剩余子任务（directExecutable=false 或直投失败的），
 *     逐个进入微循环，每个子任务最多 8 轮。
 *   - 微循环有独立的 focused prompt，只关注当前子任务。
 *   - 单个子任务失败不停机，记录原因后继续后续子任务。
 *
 * 接口设计：
 * - executeBatchDirect(): Phase 1 直投批量
 * - executeMicroLoop(): Phase 2 单任务微循环
 * - executeSubTasks(): 完整两阶段编排
 */

import type { ToolDefinition } from "../../tool-registry.js";
import type { SubTask, MicroTaskResult, DecompositionContext } from "./types.js";
import {
  buildMicroTaskSystemPrompt,
  buildMicroTaskUserMessage,
} from "./prompt.js";
import { toContentString, hasToolError, isPotentialDomMutation, computeSnapshotFingerprint } from "../helpers.js";

/** 微循环每个子任务的最大轮次 */
const MICRO_LOOP_MAX_ROUNDS = 8;

/**
 * 将 SubTask 映射为 dom 工具的 input 参数。
 *
 * 仅用于直投模式——直接构造 tool call 参数，跳过 AI。
 */
function subTaskToToolInput(task: SubTask): { toolName: string; input: Record<string, unknown> } | null {
  const target = task.target;
  if (!target.startsWith("#")) return null; // 非 hashID，无法直投

  switch (task.action) {
    case "fill":
      return {
        toolName: "dom",
        input: { action: "fill", selector: target, value: task.value ?? "" },
      };
    case "type":
      return {
        toolName: "dom",
        input: { action: "type", selector: target, text: task.value ?? "" },
      };
    case "check":
      return {
        toolName: "dom",
        input: { action: "check", selector: target },
      };
    case "uncheck":
      return {
        toolName: "dom",
        input: { action: "uncheck", selector: target },
      };
    case "select_option":
      return {
        toolName: "dom",
        input: { action: "select_option", selector: target, value: task.value ?? "" },
      };
    case "click":
      return {
        toolName: "dom",
        input: { action: "click", selector: target },
      };
    case "press":
      return {
        toolName: "dom",
        input: { action: "press", selector: target, key: task.value ?? "Enter" },
      };
    default:
      return null;
  }
}

/**
 * Phase 1：直投批量执行。
 *
 * 将所有 directExecutable=true 的非 DOM 变更子任务批量执行。
 * click 类任务单独处理（因为会断轮）。
 *
 * @returns 包含每个子任务执行结果的 Map（subTaskId → result）
 */
export async function executeBatchDirect(
  tasks: SubTask[],
  ctx: DecompositionContext,
): Promise<Map<number, MicroTaskResult>> {
  const results = new Map<number, MicroTaskResult>();

  // 分离：非 DOM 变更（可批量）vs DOM 变更（click/press，需逐个）
  const batchTasks = tasks.filter(
    t => t.directExecutable && t.action !== "click" && t.action !== "press",
  );
  const clickTasks = tasks.filter(
    t => t.directExecutable && (t.action === "click" || t.action === "press"),
  );

  // 批量执行非 DOM 变更任务
  for (const task of batchTasks) {
    const mapped = subTaskToToolInput(task);
    if (!mapped) {
      results.set(task.id, {
        subTaskId: task.id,
        status: "failed",
        description: task.description,
        failReason: "Cannot map to tool call",
        roundsUsed: 0,
      });
      continue;
    }

    ctx.callbacks?.onToolCall?.(mapped.toolName, mapped.input);
    const result = await ctx.registry.dispatch(mapped.toolName, mapped.input);
    ctx.callbacks?.onToolResult?.(mapped.toolName, result);

    if (hasToolError(result)) {
      results.set(task.id, {
        subTaskId: task.id,
        status: "failed",
        description: task.description,
        failReason: toContentString(result.content),
        roundsUsed: 1,
      });
    } else {
      results.set(task.id, {
        subTaskId: task.id,
        status: "done",
        description: task.description,
        roundsUsed: 1,
      });
    }
  }

  // 逐个执行 DOM 变更任务（每个执行后需要等稳定 + 刷新快照）
  for (const task of clickTasks) {
    const mapped = subTaskToToolInput(task);
    if (!mapped) {
      results.set(task.id, {
        subTaskId: task.id,
        status: "failed",
        description: task.description,
        failReason: "Cannot map to tool call",
        roundsUsed: 0,
      });
      continue;
    }

    ctx.callbacks?.onToolCall?.(mapped.toolName, mapped.input);
    const result = await ctx.registry.dispatch(mapped.toolName, mapped.input);
    ctx.callbacks?.onToolResult?.(mapped.toolName, result);

    if (hasToolError(result)) {
      results.set(task.id, {
        subTaskId: task.id,
        status: "failed",
        description: task.description,
        failReason: toContentString(result.content),
        roundsUsed: 1,
      });
    } else {
      results.set(task.id, {
        subTaskId: task.id,
        status: "done",
        description: task.description,
        roundsUsed: 1,
      });
      // click 后等稳定 + 刷新快照
      await ctx.runStabilityBarrier();
      await ctx.refreshSnapshot();
    }
  }

  return results;
}

/**
 * Phase 2：微循环执行单个子任务。
 *
 * 最多 MICRO_LOOP_MAX_ROUNDS 轮，内置框架级完成检测：
 * 1. 构建 focused prompt（子任务 + 最新快照）
 * 2. 调用 AI 获取 tool calls
 * 3. 执行 tool calls
 * 4. 框架级完成判定（非 DOM 变更全部成功 → 自动完成）
 * 5. 快照指纹对比（DOM 变更后快照未变 → 提示无效操作）
 * 6. 检查 AI 文本中的 MICROTASK 状态（显式优先）
 * 7. 连续无进展保护（2 轮无工具 → 自动失败）
 */
export async function executeMicroLoop(
  task: SubTask,
  ctx: DecompositionContext,
): Promise<MicroTaskResult> {
  const systemPrompt = buildMicroTaskSystemPrompt();
  const tools = ctx.registry.getDefinitions().filter(isExecutableTool);
  let previousAttemptSummary: string | undefined;
  /** 连续无工具调用且无明确状态的轮数 */
  let noProgressRounds = 0;

  for (let round = 0; round < MICRO_LOOP_MAX_ROUNDS; round++) {
    // 确保有最新快照
    if (!ctx.pageContext.latestSnapshot) {
      await ctx.refreshSnapshot();
    }

    const userMessage = buildMicroTaskUserMessage(
      task,
      ctx.pageContext.latestSnapshot || "(no snapshot)",
      ctx.pageContext.currentUrl,
      previousAttemptSummary,
    );

    // 调用 AI
    const response = await ctx.client.chat({
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools,
    });

    // ── 无工具调用分支 ──
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const status = parseMicroTaskStatus(response.text);
      if (status === "done") {
        return {
          subTaskId: task.id,
          status: "done",
          description: task.description,
          roundsUsed: round + 1,
        };
      }
      if (status === "failed") {
        return {
          subTaskId: task.id,
          status: "failed",
          description: task.description,
          failReason: extractFailReason(response.text),
          roundsUsed: round + 1,
        };
      }
      // 无工具 + 无状态 → 无进展
      noProgressRounds++;
      if (noProgressRounds >= 2) {
        return {
          subTaskId: task.id,
          status: "failed",
          description: task.description,
          failReason: "No progress: consecutive rounds without tool calls or status",
          roundsUsed: round + 1,
        };
      }
      previousAttemptSummary = `AI returned no tool calls. Response: ${(response.text ?? "").slice(0, 200)}`;
      await ctx.refreshSnapshot();
      continue;
    }

    // 有工具调用 → 重置无进展计数
    noProgressRounds = 0;

    // 记录行动前快照指纹（用于 DOM 变更后对比）
    const preFingerprint = ctx.pageContext.latestSnapshot
      ? computeSnapshotFingerprint(ctx.pageContext.latestSnapshot)
      : "";

    // 执行工具调用
    let roundHasDomMutation = false;
    let allSucceeded = true;
    const roundResults: string[] = [];

    for (const tc of response.toolCalls) {
      // 过滤掉分解和断言工具（微循环内不允许嵌套调用）
      if (tc.name === "plan_and_execute" || tc.name === "assert") continue;

      ctx.callbacks?.onToolCall?.(tc.name, tc.input);
      const result = await ctx.registry.dispatch(tc.name, tc.input);
      ctx.callbacks?.onToolResult?.(tc.name, result);

      const content = toContentString(result.content);
      const brief = content.split("\n").find(l => l.trim())?.trim().slice(0, 100) ?? "";
      const isError = hasToolError(result);
      if (isError) allSucceeded = false;
      const errorFlag = isError ? " [ERROR]" : "";
      roundResults.push(`${tc.name}(${JSON.stringify(tc.input).slice(0, 80)}) → ${brief}${errorFlag}`);

      if (isPotentialDomMutation(tc.name, tc.input)) {
        roundHasDomMutation = true;
        break; // click = 断轮
      }
    }

    // ── 显式状态检测（优先级最高） ──
    const status = parseMicroTaskStatus(response.text);
    if (status === "done") {
      return {
        subTaskId: task.id,
        status: "done",
        description: task.description,
        roundsUsed: round + 1,
      };
    }
    if (status === "failed") {
      return {
        subTaskId: task.id,
        status: "failed",
        description: task.description,
        failReason: extractFailReason(response.text),
        roundsUsed: round + 1,
      };
    }

    // ── 框架级自动完成：非 DOM 变更 + 全部成功 → 直接完成 ──
    // fill/type/check/select_option 成功即代表值已设置，无需额外 AI 确认轮
    if (allSucceeded && !roundHasDomMutation && roundResults.length > 0) {
      return {
        subTaskId: task.id,
        status: "done",
        description: task.description,
        roundsUsed: round + 1,
      };
    }

    // 等稳定 + 刷新快照后继续
    if (roundHasDomMutation) {
      await ctx.runStabilityBarrier();
    }
    await ctx.refreshSnapshot();

    // ── 快照指纹对比：DOM 变更后快照未变 → 操作无效提示 ──
    if (roundHasDomMutation && preFingerprint) {
      const postFingerprint = ctx.pageContext.latestSnapshot
        ? computeSnapshotFingerprint(ctx.pageContext.latestSnapshot)
        : "";
      if (postFingerprint && preFingerprint === postFingerprint) {
        previousAttemptSummary = [
          `Round ${round + 1} executed:`,
          ...roundResults,
          "⚠ Snapshot unchanged after action — the operation had no visible effect. Try a different target or approach.",
        ].join("\n");
        continue;
      }
    }

    previousAttemptSummary = `Round ${round + 1} executed:\n${roundResults.join("\n")}`;
  }

  // 超过最大轮次
  return {
    subTaskId: task.id,
    status: "failed",
    description: task.description,
    failReason: `Exceeded max micro-loop rounds (${MICRO_LOOP_MAX_ROUNDS})`,
    roundsUsed: MICRO_LOOP_MAX_ROUNDS,
  };
}

/**
 * 完整两阶段执行编排。
 *
 * 1. Phase 1：直投批量（directExecutable=true 的子任务）
 * 2. Phase 2：微循环（直投失败 + directExecutable=false 的子任务）
 */
export async function executeSubTasks(
  subTasks: SubTask[],
  ctx: DecompositionContext,
): Promise<MicroTaskResult[]> {
  const allResults: MicroTaskResult[] = [];

  // Phase 1：直投批量
  const directTasks = subTasks.filter(t => t.directExecutable);
  const directResults = directTasks.length > 0
    ? await executeBatchDirect(directTasks, ctx)
    : new Map<number, MicroTaskResult>();

  // 刷新快照（直投执行完后需要最新状态）
  if (directTasks.length > 0) {
    await ctx.refreshSnapshot();
  }

  // 收集直投失败的任务 ID
  const directFailedIds = new Set<number>();
  for (const [id, result] of directResults) {
    if (result.status === "failed") {
      directFailedIds.add(id);
    }
    allResults.push(result);
  }

  // Phase 2：微循环（非直投 + 直投失败的子任务）
  const microTasks = subTasks.filter(
    t => !t.directExecutable || directFailedIds.has(t.id),
  );

  for (const task of microTasks) {
    // 直投失败的任务已有结果记录，先移除旧记录
    if (directFailedIds.has(task.id)) {
      const idx = allResults.findIndex(r => r.subTaskId === task.id);
      if (idx !== -1) allResults.splice(idx, 1);
    }

    const result = await executeMicroLoop(task, ctx);
    allResults.push(result);

    // 微循环执行后刷新快照，确保后续子任务看到最新状态
    await ctx.refreshSnapshot();
  }

  // 按 id 排序返回
  allResults.sort((a, b) => a.subTaskId - b.subTaskId);
  return allResults;
}

// ─── 内部辅助 ───

/**
 * 解析微循环 AI 返回文本中的任务状态。
 *
 * 先剥离 <think>...</think> 推理标签（DeepSeek / MiniMax 等模型），
 * 再识别 MICROTASK: DONE / RETRY / FAILED 标记。
 */
function parseMicroTaskStatus(text: string | undefined): "done" | "retry" | "failed" | null {
  if (!text) return null;
  // 剥离推理标签，避免 <think> 内的文字干扰协议解析
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!stripped) return null;
  if (/MICROTASK\s*:\s*DONE/i.test(stripped)) return "done";
  if (/MICROTASK\s*:\s*FAILED/i.test(stripped)) return "failed";
  if (/MICROTASK\s*:\s*RETRY/i.test(stripped)) return "retry";
  return null;
}

/**
 * 从 MICROTASK: FAILED 文本中提取失败原因。
 */
function extractFailReason(text: string | undefined): string {
  if (!text) return "Unknown failure";
  const match = text.match(/MICROTASK\s*:\s*FAILED\s*(.*)/i);
  return match?.[1]?.trim() || "Task failed (no reason given)";
}

/**
 * 过滤可在微循环中使用的工具。
 *
 * 排除 plan_and_execute（防嵌套）和 assert（微循环不做断言）。
 */
function isExecutableTool(tool: ToolDefinition): boolean {
  return tool.name !== "plan_and_execute" && tool.name !== "assert";
}
