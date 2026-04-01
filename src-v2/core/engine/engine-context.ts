/**
 * EngineContext — Agent Loop 的状态容器 + 辅助方法。
 *
 * 持有 executeAgentLoop 的全部可变状态，按职责分组：
 * - 不可变配置（从 AgentLoopParams 展开）
 * - 输出累积（toolCalls, toolTrace, reply, metrics）
 * - 页面状态（snapshot, url, recovery）
 * - 任务推进状态（remaining, tasks, model output）
 * - 防护计数器（空转、协议缺失、重复批次、滞止等）
 *
 * Phase 函数通过读写 EngineContext 驱动状态流转，
 * 主循环仅负责编排 phase 调用顺序。
 */
import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_ROUND_STABILITY_WAIT_LOADING_SELECTORS,
  DEFAULT_ROUND_STABILITY_WAIT_QUIET_MS,
  DEFAULT_ROUND_STABILITY_WAIT_TIMEOUT_MS,
} from "../shared/constants.js";
import {
  splitUserGoalIntoTasks,
  hasToolError,
} from "../shared/helpers.js";
import { readPageSnapshot } from "../shared/snapshot/index.js";
import type {
  AgentLoopParams,
  AgentLoopResult,
  AgentLoopMetrics,
  AgentLoopCallbacks,
  PageContextState,
  ToolTraceEntry,
  StopReason,
  TaskItem,
  AIClient,
  AIMessage,
} from "../shared/types.js";
import type { ToolRegistry, ToolCallResult, ToolDefinition } from "../shared/tool-registry.js";
import type { AssertionConfig, AssertionResult } from "../assertion/types.js";

export type MissingToolTask = {
  name: string;
  input: unknown;
  reason: string;
};

export class EngineContext {
  // ═══ 不可变配置 ═══
  readonly client: AIClient;
  readonly registry: ToolRegistry;
  readonly tools: ToolDefinition[];
  readonly systemPrompt: string;
  readonly message: string;
  readonly initialSnapshot: string | undefined;
  readonly history: AIMessage[] | undefined;
  readonly dryRun: boolean;
  readonly maxRounds: number;
  readonly assertionConfig: AssertionConfig | undefined;
  readonly callbacks: AgentLoopCallbacks | undefined;
  readonly effectiveRoundStabilityWait: {
    enabled: boolean;
    timeoutMs: number;
    quietMs: number;
    loadingSelectors: string[];
  };

  // ═══ 输出累积 ═══
  allToolCalls: AgentLoopResult["toolCalls"] = [];
  fullToolTrace: ToolTraceEntry[] = [];
  finalReply = "";
  stopReason: StopReason = "max_rounds";
  lastAssertionResult: AssertionResult | undefined;
  inputTokens = 0;
  outputTokens = 0;
  usedRounds = 0;
  snapshotReadCount = 0;
  snapshotSizeTotal = 0;
  snapshotSizeMax = 0;
  recoveryCount = 0;
  redundantInterceptCount = 0;

  // ═══ 页面状态 ═══
  pageContext: PageContextState;
  actionRecoveryAttempts = new Map<string, number>();
  snapshotExpandRefIds = new Set<string>();
  previousRoundSnapshot = "";

  // ═══ 任务推进状态 ═══
  remainingInstruction: string;
  previousRoundTasks: string[] = [];
  previousRoundPlannedTasks: string[] = [];
  previousRoundModelOutput = "";
  taskItems: TaskItem[] | null;
  protocolViolationHint: string | undefined;

  // ═══ 防护计数器 ═══
  consecutiveReadOnlyRounds = 0;
  consecutiveNoProtocolRounds = 0;
  consecutiveSamePlannedBatch = 0;
  lastPlannedBatchKey = "";
  lastRoundHadError = false;
  consecutiveAssertOnlyFailedRounds = 0;
  consecutiveNoProgressRounds = 0;
  previousRoundRemaining: string;
  ineffectiveClickSelectors = new Set<string>();
  recentRoundClickTargets: string[][] = [];
  pendingNotFoundRetry:
    | { attempt: number; tasks: MissingToolTask[] }
    | undefined;

  constructor(params: AgentLoopParams) {
    this.client = params.client;
    this.registry = params.registry;
    this.tools = params.registry.getDefinitions();
    this.systemPrompt = params.systemPrompt;
    this.message = params.message;
    this.initialSnapshot = params.initialSnapshot;
    this.history = params.history;
    this.dryRun = params.dryRun ?? false;
    this.maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
    this.assertionConfig = params.assertionConfig;
    this.callbacks = params.callbacks;

    const rsw = params.roundStabilityWait;
    this.effectiveRoundStabilityWait = {
      enabled: rsw?.enabled ?? true,
      timeoutMs: Math.max(200, Math.floor(rsw?.timeoutMs ?? DEFAULT_ROUND_STABILITY_WAIT_TIMEOUT_MS)),
      quietMs: Math.max(50, Math.floor(rsw?.quietMs ?? DEFAULT_ROUND_STABILITY_WAIT_QUIET_MS)),
      loadingSelectors: [
        ...new Set(
          [
            ...DEFAULT_ROUND_STABILITY_WAIT_LOADING_SELECTORS,
            ...(rsw?.loadingSelectors ?? []),
          ]
            .map(selector => selector.trim())
            .filter(Boolean),
        ),
      ],
    };

    this.pageContext = { latestSnapshot: params.initialSnapshot };
    this.remainingInstruction = params.message.trim();
    this.previousRoundRemaining = this.remainingInstruction;
    this.taskItems = splitUserGoalIntoTasks(params.message);

    if (this.pageContext.latestSnapshot) {
      this.recordSnapshotStats(this.pageContext.latestSnapshot);
    }
  }

  // ═══ 辅助方法 ═══

  recordSnapshotStats(snapshot: string | undefined): void {
    if (typeof snapshot !== "string") return;
    this.snapshotReadCount += 1;
    this.snapshotSizeTotal += snapshot.length;
    if (snapshot.length > this.snapshotSizeMax) this.snapshotSizeMax = snapshot.length;
  }

  async refreshSnapshot(): Promise<void> {
    this.pageContext.latestSnapshot = await readPageSnapshot(
      this.registry,
      this.snapshotExpandRefIds.size > 0
        ? { expandChildrenRefs: Array.from(this.snapshotExpandRefIds), expandedChildrenLimit: 120 }
        : undefined,
    );
    this.recordSnapshotStats(this.pageContext.latestSnapshot);
  }

  async runRoundStabilityBarrier(): Promise<void> {
    if (!this.effectiveRoundStabilityWait.enabled) return;
    if (!this.registry.has("wait")) return;

    const timeout = this.effectiveRoundStabilityWait.timeoutMs;
    const loadingSelector = this.effectiveRoundStabilityWait.loadingSelectors.join(", ");

    if (loadingSelector) {
      await this.registry.dispatch("wait", {
        action: "wait_for_selector",
        selector: loadingSelector,
        state: "hidden",
        timeout,
      });
    }

    await this.registry.dispatch("wait", {
      action: "wait_for_stable",
      timeout,
      quietMs: this.effectiveRoundStabilityWait.quietMs,
    });
  }

  appendToolTrace(
    round: number,
    name: string,
    input: unknown,
    result: AgentLoopResult["toolCalls"][number]["result"],
  ): void {
    this.allToolCalls.push({ name, input, result });
    this.fullToolTrace.push({ round, name, input, result });
  }

  buildResult(): AgentLoopResult {
    const resultMessages: AIMessage[] = [...(this.history ?? []), { role: "user", content: this.message }];
    if (this.finalReply) {
      resultMessages.push({ role: "assistant", content: this.finalReply });
    }

    const successfulToolCalls = this.allToolCalls.filter(tc => {
      const details = tc.result.details;
      return !(details && typeof details === "object" && Boolean((details as { error?: unknown }).error));
    }).length;
    const failedToolCalls = this.allToolCalls.length - successfulToolCalls;

    const metrics: AgentLoopMetrics = {
      roundCount: this.usedRounds,
      totalToolCalls: this.allToolCalls.length,
      successfulToolCalls,
      failedToolCalls,
      toolSuccessRate: this.allToolCalls.length > 0
        ? Number((successfulToolCalls / this.allToolCalls.length).toFixed(4))
        : 1,
      recoveryCount: this.recoveryCount,
      redundantInterceptCount: this.redundantInterceptCount,
      snapshotReadCount: this.snapshotReadCount,
      latestSnapshotSize: this.pageContext.latestSnapshot?.length ?? 0,
      avgSnapshotSize: this.snapshotReadCount > 0 ? Math.round(this.snapshotSizeTotal / this.snapshotReadCount) : 0,
      maxSnapshotSize: this.snapshotSizeMax,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      stopReason: this.stopReason,
    };

    this.callbacks?.onMetrics?.(metrics);

    return {
      reply: this.finalReply,
      toolCalls: this.allToolCalls,
      messages: resultMessages,
      metrics,
      ...(this.lastAssertionResult ? { assertionResult: this.lastAssertionResult } : {}),
      finalSnapshot: this.pageContext.latestSnapshot,
    };
  }
}
