/**
 * ExecutionRecordChain 实现 — 管理微任务执行记录的有序集合。
 *
 * 每当一个微任务完成，TaskMonitor 会调用 `chain.append(record)` 将记录追加到链中。
 * 链提供两种格式化输出，服务于不同消费方：
 *
 * ## buildPreviousContext() — 精简版，注入下一个微任务的 prompt
 *
 * 让执行 AI 知道"前面做过什么"，输出示例：
 * ```
 * ✅ 填写用户名: 输入框已填写为 admin
 * ✅ 填写密码: 密码框已填写
 * ✗ 点击登录 (failed): 登录按钮被遮挡
 * ```
 *
 * ## buildEvidenceSummary() — 完整版，给系统级断言 AI 做终判
 *
 * 包含操作详情和断言结果，输出示例：
 * ```
 * [1] 填写用户名
 *     status: success
 *     completedSubGoals: 输入框已填写为 admin
 *     actions: fill("#username", "admin")
 * [2] 点击登录
 *     status: failed
 *     actions: click("#login-btn")
 *     assertion: FAILED (1/2)
 *       - 页面跳转: ❌ 仍停留在登录页
 * ```
 */
import type { MicroTaskExecutionRecord } from "../assertion/types.js";
import type { ExecutionRecordChain } from "./types.js";

class ExecutionRecordChainImpl implements ExecutionRecordChain {
  private _records: MicroTaskExecutionRecord[] = [];

  get records(): readonly MicroTaskExecutionRecord[] {
    return this._records;
  }

  append(record: MicroTaskExecutionRecord): void {
    this._records.push(record);
  }

  /**
   * 格式化精简上下文。
   *
   * 规则:
   * - 空链 → "(no prior micro-tasks)"
   * - 成功记录 → "✅ {task}: {completedSubGoals 逗号分隔}"
   * - 失败记录 → "✗ {task} (failed): {summary}"
   * - 多条记录用换行分隔
   */
  buildPreviousContext(): string {
    if (this._records.length === 0) {
      return "(no prior micro-tasks)";
    }
    return this._records
      .map((r) => {
        if (r.success) {
          return `✅ ${r.task}: ${r.completedSubGoals.join(", ")}`;
        }
        return `✗ ${r.task} (failed): ${r.summary}`;
      })
      .join("\n");
  }

  /**
   * 格式化完整证据摘要。
   *
   * 每条记录输出:
   * - `[编号] task`
   * - `    status: success | failed`
   * - `    completedSubGoals: ...`（非空时）
   * - `    actions: ...`（非空时，分号分隔）
   * - `    assertion: PASSED|FAILED (n/m)`（有断言结果时）
   * -       `- 子任务: ✅|❌ 理由`（逐条展示）
   */
  buildEvidenceSummary(): string {
    if (this._records.length === 0) {
      return "(no execution records)";
    }
    return this._records
      .map((r, i) => {
        const lines: string[] = [];
        lines.push(`[${i + 1}] ${r.task}`);
        lines.push(`    status: ${r.success ? "success" : "failed"}`);
        if (r.completedSubGoals.length > 0) {
          lines.push(`    completedSubGoals: ${r.completedSubGoals.join(", ")}`);
        }
        if (r.actions.length > 0) {
          lines.push(`    actions: ${r.actions.join("; ")}`);
        }
        if (r.assertionResult) {
          const ar = r.assertionResult;
          lines.push(
            `    assertion: ${ar.allPassed ? "PASSED" : "FAILED"} (${ar.passed}/${ar.total})`,
          );
          for (const d of ar.details) {
            lines.push(
              `      - ${d.task}: ${d.passed ? "✅" : "❌"} ${d.reason}`,
            );
          }
        }
        return lines.join("\n");
      })
      .join("\n");
  }
}

/**
 * 创建一个空的 ExecutionRecordChain。
 *
 * @example
 * ```ts
 * const chain = createExecutionRecordChain();
 * chain.append(executionRecord);
 * console.log(chain.buildPreviousContext());
 * // → "✅ 填写用户名: 输入框已填写为 admin"
 * ```
 */
export function createExecutionRecordChain(): ExecutionRecordChain {
  return new ExecutionRecordChainImpl();
}
