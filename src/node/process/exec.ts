/**
 * 进程执行工具 — 提供两种方式运行外部命令。
 *
 * 两个核心函数：
 * - runExec()              — 简单执行，适合快速跑一条命令拿输出
 * - runCommandWithTimeout() — 完整控制，支持超时、工作目录、stdin 输入、自定义环境变量
 *
 * exec-tool.ts 通过 runCommandWithTimeout() 让 AI 能执行 shell 命令。
 */
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

/** 将 execFile 包装为 Promise 风格，方便 async/await 调用 */
const execFileAsync = promisify(execFile);

/**
 * Windows 兼容：为 npm/pnpm/yarn/npx 等命令自动补上 .cmd 后缀。
 * 在 Windows 上这些工具实际是 .cmd 脚本，不加后缀会找不到。
 * macOS/Linux 不受影响，直接原样返回。
 */
function resolveCommand(command: string): string {
  if (process.platform !== "win32") return command;
  const basename = path.basename(command).toLowerCase();
  if (path.extname(basename)) return command;
  const cmdCommands = ["npm", "pnpm", "yarn", "npx"];
  if (cmdCommands.includes(basename)) return `${command}.cmd`;
  return command;
}

/**
 * 简单命令执行 — 适合不需要 stdin、不需要精细控制的场景。
 *
 * @param command  - 可执行文件路径（如 "git"、"node"）
 * @param args     - 参数数组（如 ["status", "--short"]）
 * @param opts     - 超时毫秒数，或 { timeoutMs, maxBuffer } 配置对象
 * @returns stdout 和 stderr 文本
 *
 * 内部使用 execFile（非 shell），更安全，不会被 shell 注入攻击。
 */
export async function runExec(
  command: string,
  args: string[],
  opts: number | { timeoutMs?: number; maxBuffer?: number } = 10_000,
): Promise<{ stdout: string; stderr: string }> {
  const options =
    typeof opts === "number"
      ? { timeout: opts, encoding: "utf8" as const }
      : { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer, encoding: "utf8" as const };
  const { stdout, stderr } = await execFileAsync(resolveCommand(command), args, options);
  return { stdout, stderr };
}

/** spawn 执行结果 */
export type SpawnResult = {
  /** 标准输出内容 */
  stdout: string;
  /** 标准错误内容 */
  stderr: string;
  /** 进程退出码（0=成功，非0=失败，null=被信号终止） */
  code: number | null;
  /** 终止信号（如 SIGKILL、SIGTERM），正常退出时为 null */
  signal: NodeJS.Signals | null;
  /** 是否因超时被强制杀死 */
  killed: boolean;
};

/** 命令执行选项 */
export type CommandOptions = {
  /** 超时时间（毫秒），超时后自动 SIGKILL 杀死进程 */
  timeoutMs: number;
  /** 工作目录，默认继承当前进程 */
  cwd?: string;
  /** 写入子进程 stdin 的内容（如果需要向命令传入数据） */
  input?: string;
  /** 额外环境变量，会与 process.env 合并 */
  env?: NodeJS.ProcessEnv;
};

/**
 * 带超时的命令执行 — exec-tool 的底层实现。
 *
 * 完整流程：
 *   1. spawn 启动子进程（通过 shell 执行命令）
 *   2. 设置定时器：超时后 SIGKILL 强杀
 *   3. 收集 stdout/stderr 输出
 *   4. 等待进程退出，返回 SpawnResult
 *
 * @param argv             - 命令 + 参数数组，如 ["bash", "-c", "ls -la"]
 * @param optionsOrTimeout - 超时毫秒数，或完整 CommandOptions 配置
 * @returns SpawnResult（stdout、stderr、退出码、信号、是否被杀）
 */
export async function runCommandWithTimeout(
  argv: string[],
  optionsOrTimeout: number | CommandOptions,
): Promise<SpawnResult> {
  const options: CommandOptions =
    typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
  const { timeoutMs, cwd, input, env } = options;
  const hasInput = input !== undefined;

  // 合并环境变量：自定义 env 覆盖 process.env 中的同名变量
  const resolvedEnv = env ? { ...process.env, ...env } : { ...process.env };

  // stdio 配置：有 input 时 stdin 用 pipe（写入数据），否则 inherit（继承终端）
  // stdout 和 stderr 始终用 pipe（收集输出）
  const stdio: Array<"pipe" | "inherit" | "ignore"> = hasInput
    ? ["pipe", "pipe", "pipe"]
    : ["inherit", "pipe", "pipe"];

  // 启动子进程
  const child = spawn(resolveCommand(argv[0]!), argv.slice(1), {
    stdio,
    cwd,
    env: resolvedEnv,
  });

  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false; // 防止 error 和 close 事件重复触发

    // 超时定时器：超时后强制杀死子进程
    const timer = setTimeout(() => {
      if (typeof child.kill === "function") child.kill("SIGKILL");
    }, timeoutMs);

    // 如果有 input，写入 stdin 后关闭（告诉子进程输入结束）
    if (hasInput && child.stdin) {
      child.stdin.write(input ?? "");
      child.stdin.end();
    }

    // 持续收集 stdout 和 stderr 输出
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    // 进程启动失败（如命令不存在）→ reject
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    // 进程正常/异常退出 → resolve（即使退出码非 0 也不 reject，由调用方判断）
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal, killed: child.killed });
    });
  });
}
