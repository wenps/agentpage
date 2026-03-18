/**
 * Micro Task 模块 — 微任务数据结构与执行编排。
 *
 * ## 模块定位
 *
 * 用户下达一个复杂指令时，Main Agent 将其拆解为多个原子级微任务，
 * 本模块提供微任务的**数据结构层**（描述、结果、记录链）和**编排层**（TaskMonitor）。
 *
 * ## 核心导出
 *
 * - **类型**: MicroTaskDescriptor（任务描述）、MicroTaskResult（执行结果）、
 *   ExecutionRecordChain（记录链接口）、MicroTaskExecuteFn（执行回调）
 * - **实现**: createExecutionRecordChain()（工厂函数）、TaskMonitor（编排器）
 *
 * ## 典型用法
 *
 * ```ts
 * import { TaskMonitor } from "./micro-task/index.js";
 *
 * const monitor = new TaskMonitor();
 * await monitor.execute({ id: "mt-1", task: "填写用户名" }, executeFn);
 * await monitor.execute({ id: "mt-2", task: "点击登录" }, executeFn);
 * const evidence = monitor.recordChain.buildEvidenceSummary();
 * ```
 */

// ─── 类型 ───
export type {
  MicroTaskDescriptor,
  MicroTaskResult,
  ExecutionRecordChain,
  MicroTaskExecuteFn,
  MicroTaskExecutionRecord,
  TaskAssertion,
  AssertionResult,
} from "./types.js";

// ─── 实现 ───
export { createExecutionRecordChain } from "./record.js";
export { TaskMonitor } from "./task-monitor.js";
