/**
 * TaskMonitor — 微任务执行编排器。
 *
 * ## 职责
 *
 * TaskMonitor 是 Main Agent 和 micro-task engine 之间的中间层：
 * - 维护一条 ExecutionRecordChain（所有已完成微任务的执行记录）
 * - 每次 execute() 时自动注入"之前做过什么"的上下文
 * - 执行完成后自动将新记录追加到链中
 *
 * ## 使用流程
 *
 * ```
 *   Main Agent
 *     │
 *     ├── 拆解用户指令为 [MT-1, MT-2, MT-3]
 *     │
 *     ▼
 *   TaskMonitor.execute(MT-1, executeFn)
 *     │  previousContext = "(no prior micro-tasks)"
 *     │  → executeFn(MT-1, previousContext) → result1
 *     │  → chain.append(result1.executionRecord)
 *     │
 *   TaskMonitor.execute(MT-2, executeFn)
 *     │  previousContext = "✅ 填写用户名: 已填写 admin"
 *     │  → executeFn(MT-2, previousContext) → result2
 *     │  → chain.append(result2.executionRecord)
 *     │
 *     ▼
 *   最终: monitor.recordChain.buildEvidenceSummary()
 *     → 传给系统级断言做总判定
 * ```
 *
 * ## 为什么用 executeFn 回调？
 *
 * `execute()` 接受 `executeFn` 回调而非直接持有 engine 实例：
 * - micro-task 模块不依赖尚未实现的 engine 模块
 * - 测试时传入 mock 函数，无需构造真实 engine
 * - engine 就绪后在调用侧一行 lambda 组装：
 *   `monitor.execute(descriptor, (d, ctx) => engine.run(d, ctx))`
 *
 * @example
 * ```ts
 * const monitor = new TaskMonitor();
 *
 * // 逐个执行微任务
 * const result1 = await monitor.execute(
 *   { id: "mt-1", task: "填写用户名" },
 *   (descriptor, previousContext) => engine.run(descriptor, previousContext),
 * );
 *
 * const result2 = await monitor.execute(
 *   { id: "mt-2", task: "点击登录" },
 *   (descriptor, previousContext) => engine.run(descriptor, previousContext),
 * );
 *
 * // 获取完整证据供系统断言使用
 * const evidence = monitor.recordChain.buildEvidenceSummary();
 *
 * // 重置（如需处理新的用户指令）
 * monitor.reset();
 * ```
 */
import type {
  MicroTaskDescriptor,
  MicroTaskResult,
  MicroTaskExecuteFn,
  ExecutionRecordChain,
} from "./types.js";
import { createExecutionRecordChain } from "./record.js";

export class TaskMonitor {
  private _recordChain: ExecutionRecordChain;

  constructor() {
    this._recordChain = createExecutionRecordChain();
  }

  /** 当前执行记录链（可直接调用 buildPreviousContext / buildEvidenceSummary） */
  get recordChain(): ExecutionRecordChain {
    return this._recordChain;
  }

  /**
   * 执行一个微任务。
   *
   * 流程：
   * 1. 从 recordChain 获取 previousContext（之前微任务的精简摘要）
   * 2. 调用 executeFn(descriptor, previousContext) 驱动实际页面操作
   * 3. 将 result.executionRecord 追加到 recordChain
   * 4. 原样返回 result 给 Main Agent 做后续决策
   *
   * @param descriptor - 要执行的微任务描述
   * @param executeFn - 执行回调（由调用方注入，通常封装 engine.run）
   * @returns executeFn 返回的原始结果
   */
  async execute(
    descriptor: MicroTaskDescriptor,
    executeFn: MicroTaskExecuteFn,
  ): Promise<MicroTaskResult> {
    const previousContext = this._recordChain.buildPreviousContext();
    const result = await executeFn(descriptor, previousContext);
    this._recordChain.append(result.executionRecord);
    return result;
  }

  /**
   * 重置记录链 — 清空所有已追加的执行记录。
   *
   * 适用于 Main Agent 开始处理新的用户指令时，
   * 避免上一轮指令的记录污染新指令的上下文。
   */
  reset(): void {
    this._recordChain = createExecutionRecordChain();
  }
}
