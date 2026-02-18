/**
 * Exec Tool — Shell 命令执行工具，让 AI 能运行任意终端命令。
 *
 * 这是 AI 的"双手"之一：可以执行 git、npm、ls、curl 等任何 shell 命令。
 *
 * 安全设计：
 * - 默认超时 30 秒，防止命令挂起
 * - 输出截断上限 30,000 字符，防止超长输出撑爆上下文
 * - 自动清理二进制/控制字符，避免乱码
 *
 * 执行流程：
 *   AI 传入 command → getShellConfig() 获取系统 shell（bash/zsh/powershell）
 *   → runCommandWithTimeout() 执行 → 清理输出 → 返回 stdout/stderr + 退出码
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";
import { getShellConfig, sanitizeBinaryOutput } from "../process/shell.js";
import { runCommandWithTimeout, type SpawnResult } from "../process/exec.js";

/** 输出最大字符数，超过则截断 */
const MAX_OUTPUT_CHARS = 30_000;
/** 默认命令超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 截断过长的命令输出。
 * 策略：保留前半和后半各 maxChars/2 的内容，中间标注省略了多少字符。
 * 这样 AI 既能看到开头的关键信息，也能看到末尾的结果/错误。
 */
function truncateOutput(text: string, maxChars: number = MAX_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n\n…[truncated ${text.length - maxChars} chars]…\n\n${text.slice(-half)}`;
}

export function createExecTool(): ToolDefinition {
  return {
    name: "exec",
    description: [
      "Execute a shell command and return stdout/stderr.",
      "Use for file operations, git, system commands, etc.",
      "Commands run in the user's shell (bash/zsh/powershell).",
      "Timeout: 30s by default. Destructive actions require user confirmation.",
    ].join(" "),
    schema: Type.Object({
      command: Type.String({ description: "The shell command to execute" }),
      cwd: Type.Optional(Type.String({ description: "Working directory for the command" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default 30000)" })),
    }),
    execute: async (params): Promise<ToolCallResult> => {
      const command = params.command as string;
      const cwd = params.cwd as string | undefined;
      const timeoutMs = (params.timeoutMs as number) ?? DEFAULT_TIMEOUT_MS;

      // 获取当前系统的 shell 配置（macOS/Linux → bash/zsh，Windows → PowerShell）
      const { shell, args } = getShellConfig();
      // 拼装完整命令：["bash", "-c", "ls -la"]
      const argv = [shell, ...args, command];

      let result: SpawnResult;
      try {
        // 通过 spawn 执行命令，支持超时自动 SIGKILL
        result = await runCommandWithTimeout(argv, { timeoutMs, cwd });
      } catch (err) {
        return {
          content: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
          details: { error: true, command },
        };
      }

      // 清理输出中的二进制/控制字符（保留 tab、换行）
      const stdout = sanitizeBinaryOutput(result.stdout);
      const stderr = sanitizeBinaryOutput(result.stderr);
      // 拼装最终输出：stdout 和 stderr 分别标注，超长则截断
      const output = [
        stdout ? `stdout:\n${truncateOutput(stdout)}` : "",
        stderr ? `stderr:\n${truncateOutput(stderr)}` : "",
      ].filter(Boolean).join("\n\n");

      return {
        content: output || "(no output)",
        details: {
          command,
          exitCode: result.code,
          signal: result.signal,
          killed: result.killed,
        },
      };
    },
  };
}
