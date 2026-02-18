/**
 * Shell 检测与输出处理 — 让 exec-tool 能在不同操作系统上正确执行命令。
 *
 * 核心能力：
 * - getShellConfig()       — 自动检测当前系统的 shell（bash/zsh/powershell），返回可直接传给 spawn 的参数
 * - detectRuntimeShell()   — 检测用户当前使用的 shell 名称（用于提示词/日志）
 * - sanitizeBinaryOutput() — 清理命令输出中的二进制/控制字符（防止乱码传给 AI）
 * - killProcessTree()      — 杀死进程及其所有子进程（用于超时清理）
 *
 * exec-tool 的调用链：
 *   AI 传入 command → getShellConfig() 拿到 shell 和 args
 *   → spawn(shell, [...args, command]) 执行
 *   → sanitizeBinaryOutput() 清理输出 → 返回给 AI
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Windows 下查找 PowerShell 可执行文件的完整路径。
 * 优先从 System32 目录查找，找不到则回退到 PATH 中的 powershell.exe。
 */
function resolvePowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    const candidate = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
}

/**
 * 获取当前系统的 shell 配置 — exec-tool 的核心依赖。
 *
 * 返回 { shell, args }，直接用于 spawn(shell, [...args, command])。
 *
 * 平台策略：
 * - Windows → PowerShell（-NoProfile -NonInteractive -Command）
 * - macOS/Linux → 读取 $SHELL 环境变量（通常是 bash 或 zsh）
 * - Fish shell → 自动降级到 bash（因为 fish 语法不兼容 bash 命令）
 * - 都没有 → 回退到 sh
 */
export function getShellConfig(): { shell: string; args: string[] } {
  // Windows 用 PowerShell
  if (process.platform === "win32") {
    return { shell: resolvePowerShellPath(), args: ["-NoProfile", "-NonInteractive", "-Command"] };
  }

  // macOS/Linux：从 $SHELL 环境变量获取用户默认 shell
  const envShell = process.env.SHELL?.trim();
  const shellName = envShell ? path.basename(envShell) : "";

  // Fish shell 特殊处理：fish 语法不兼容常见 bash 命令（如 &&、||），降级到 bash
  if (shellName === "fish") {
    const bash = resolveShellFromPath("bash");
    if (bash) return { shell: bash, args: ["-c"] };
    const sh = resolveShellFromPath("sh");
    if (sh) return { shell: sh, args: ["-c"] };
  }

  // 默认使用 $SHELL，找不到则用 sh
  const shell = envShell && envShell.length > 0 ? envShell : "sh";
  return { shell, args: ["-c"] };
}

/**
 * 从 $PATH 环境变量中查找指定 shell 的可执行文件路径。
 * 逐个目录检查文件是否存在且有执行权限。
 *
 * @param name - shell 名称，如 "bash"、"sh"
 * @returns 完整路径（如 "/usr/bin/bash"），找不到返回 undefined
 */
function resolveShellFromPath(name: string): string | undefined {
  const envPath = process.env.PATH ?? "";
  if (!envPath) return undefined;
  const entries = envPath.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, name);
    try {
      // 检查文件是否有执行权限（X_OK）
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // 文件不存在或没有执行权限，继续检查下一个目录
    }
  }
  return undefined;
}

/**
 * 将 shell 路径标准化为简短名称。
 * 例如 "/usr/bin/zsh" → "zsh"，"C:\\...\\powershell.exe" → "powershell"
 */
function normalizeShellName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return path.basename(trimmed).replace(/\.(exe|cmd|bat)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * 检测当前运行环境使用的 shell 名称。
 *
 * 检测优先级：
 * 1. Windows → 看 POWERSHELL_DISTRIBUTION_CHANNEL 区分 pwsh 和 powershell
 * 2. $SHELL 环境变量
 * 3. BASH_VERSION / ZSH_VERSION / FISH_VERSION 环境变量
 *
 * @returns shell 名称（如 "zsh"、"bash"、"pwsh"），无法检测返回 undefined
 */
export function detectRuntimeShell(): string | undefined {
  if (process.platform === "win32") {
    if (process.env.POWERSHELL_DISTRIBUTION_CHANNEL) return "pwsh";
    return "powershell";
  }

  const envShell = process.env.SHELL?.trim();
  if (envShell) {
    const name = normalizeShellName(envShell);
    if (name) return name;
  }

  // 回退检测：某些环境下 $SHELL 可能为空，通过版本变量判断
  if (process.env.BASH_VERSION) return "bash";
  if (process.env.ZSH_VERSION) return "zsh";
  if (process.env.FISH_VERSION) return "fish";
  return undefined;
}

/**
 * 清理命令输出中的二进制和控制字符。
 *
 * 为什么需要：AI 模型不理解二进制数据和控制序列（如 ANSI 颜色码），
 * 这些字符会干扰 AI 的理解，甚至导致 API 请求失败。
 *
 * 处理规则：
 * - 保留 Tab(\t)、换行(\n)、回车(\r)  — 这些对文本格式有意义
 * - 移除 Unicode Format 类字符和 Surrogate 字符
 * - 移除所有 ASCII 控制字符（code < 0x20）
 */
export function sanitizeBinaryOutput(text: string): string {
  // 第一步：移除 Unicode 格式字符和 Surrogate 代理对
  const scrubbed = text.replace(/[\p{Format}\p{Surrogate}]/gu, "");
  if (!scrubbed) return scrubbed;

  // 第二步：逐字符过滤，只保留可打印字符 + Tab/换行/回车
  const chunks: string[] = [];
  for (const char of scrubbed) {
    const code = char.codePointAt(0);
    if (code == null) continue;
    // 保留 Tab(0x09)、换行(0x0A)、回车(0x0D)
    if (code === 0x09 || code === 0x0a || code === 0x0d) { chunks.push(char); continue; }
    // 丢弃其他控制字符（0x00-0x1F）
    if (code < 0x20) continue;
    chunks.push(char);
  }
  return chunks.join("");
}

/**
 * 杀死进程及其所有子进程（进程树）。
 *
 * 用于命令超时时的清理 — 仅杀父进程可能导致子进程成为孤儿进程。
 *
 * 平台策略：
 * - Windows → 使用 taskkill /F /T（/T = 杀死整个进程树）
 * - Unix/macOS → 先尝试 kill(-pid)（负 PID 杀死整个进程组），
 *   失败则回退到 kill(pid)（仅杀父进程）
 */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", detached: true });
    } catch { /* ignore */ }
    return;
  }
  try {
    // 负 PID = 杀死整个进程组（推荐，能清理所有子进程）
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      // 回退：直接杀父进程
      process.kill(pid, "SIGKILL");
    } catch { /* 进程已经不存在 */ }
  }
}
