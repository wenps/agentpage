/**
 * 任务分解执行（Task Decomposition）类型定义。
 *
 * 核心概念：
 * - SubTask：AI 规划出的原子子任务（一个表单字段 = 一个 SubTask）
 * - DecompositionResult：分解执行的整体结果，返回给主循环
 * - MicroTaskResult：单个子任务的执行结果
 *
 * 与主循环的关系：
 * - 主循环通过 `plan_and_execute` 工具调用触发分解
 * - 分解完成后将 DecompositionResult 作为工具结果返回
 * - 主循环据此更新 remaining 和快照
 */

/** AI 规划的原子子任务 */
export type SubTask = {
  /** 子任务序号（从 1 开始） */
  id: number;
  /** 工具动作类型：fill / click / check / uncheck / select_option / press / type / custom */
  action: string;
  /**
   * 目标选择器（优先 #hashID，其次描述文本）。
   * 当 AI 在快照中找到了精确 hashID 时填 "#xxx"；
   * 否则填描述性文本（如 "部门下拉框"），由微循环 AI 定位。
   */
  target: string;
  /** 操作值（fill 的文本、select 的选项等），click/check 可为空 */
  value?: string;
  /** 人可读描述（用于日志和轨迹展示） */
  description: string;
  /**
   * 是否可直投执行。
   *
   * 满足以下条件时为 true：
   * - target 是明确的 #hashID
   * - action 是简单操作（fill / check / uncheck / select_option / type）
   *
   * 直投 = 跳过 AI 调用，直接构造 tool call 执行。
   */
  directExecutable?: boolean;
};

/** 子任务执行状态 */
export type SubTaskStatus = "pending" | "done" | "failed" | "skipped";

/** 单个子任务的执行结果 */
export type MicroTaskResult = {
  /** 子任务 ID */
  subTaskId: number;
  /** 执行状态 */
  status: SubTaskStatus;
  /** 描述（透传 SubTask.description） */
  description: string;
  /** 失败原因（status=failed 时填写） */
  failReason?: string;
  /** 执行消耗的微循环轮次 */
  roundsUsed: number;
};

/** 任务分解执行整体结果 */
export type DecompositionResult = {
  /** 规划出的子任务总数 */
  total: number;
  /** 成功完成的子任务数 */
  done: number;
  /** 失败的子任务数 */
  failed: number;
  /** 跳过的子任务数 */
  skipped: number;
  /** 每个子任务的执行结果 */
  details: MicroTaskResult[];
  /** 可读文本摘要（直接作为 tool result content 返回主循环） */
  summary: string;
};

/**
 * 分解执行引擎所需的运行时上下文。
 *
 * 从主循环透传，避免重复创建或全局耦合。
 */
export type DecompositionContext = {
  /** AI 客户端（复用主循环实例） */
  client: import("../../types.js").AIClient;
  /** 工具注册表（复用主循环实例，分解执行复用同一套 DOM 工具） */
  registry: import("../../tool-registry.js").ToolRegistry;
  /** 页面上下文状态引用（快照、URL） */
  pageContext: { latestSnapshot?: string; currentUrl?: string };
  /** 快照刷新函数（从主循环透传） */
  refreshSnapshot: () => Promise<void>;
  /** 轮次后稳定等待函数（从主循环透传） */
  runStabilityBarrier: () => Promise<void>;
  /** 回调（透传主循环回调，用于 UI 展示子任务进度） */
  callbacks?: import("../types.js").AgentLoopCallbacks;
};
