/**
 * File Tools — 文件读写和目录浏览工具，让 AI 能操作文件系统。
 *
 * 提供三个独立工具：
 * - file_read  — 读取文件内容（支持行范围选择）
 * - file_write — 写入/追加文件（自动创建父目录）
 * - list_dir   — 列出目录内容（支持递归，最深 3 层）
 *
 * 安全设计：
 * - safeResolvePath() 确保所有路径不能逃逸出工作目录
 *   例如 AI 传入 "../../etc/passwd" 会被拦截
 * - 读取内容上限 50,000 字符，防止巨型文件撑爆上下文
 * - 目录浏览自动过滤 . 开头的隐藏文件和 node_modules
 */
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";

/** 文件读取最大字符数 */
const MAX_READ_CHARS = 50_000;

/**
 * 路径安全检查 — 将相对路径解析为绝对路径，并验证是否在工作目录内。
 * 防止路径穿越攻击（如 ../../etc/passwd）。
 *
 * @returns resolved 解析后的绝对路径；error 如果路径越界则返回错误信息
 */
function safeResolvePath(filePath: string): { resolved: string; error?: string } {
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, filePath);
  // 确保解析后的路径仍在 cwd 内部（含 cwd 本身）
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    return { resolved, error: `Path escapes working directory: ${filePath}` };
  }
  return { resolved };
}

/**
 * 创建 file_read 工具 — AI 用它来读取任意文件的内容。
 * 支持通过 startLine/endLine 只读取部分行，避免读取整个大文件。
 */
export function createFileReadTool(): ToolDefinition {
  return {
    name: "file_read",
    description: "Read the contents of a file. Supports line range selection.",
    schema: Type.Object({
      filePath: Type.String({ description: "Absolute or relative path to the file" }),
      startLine: Type.Optional(Type.Number({ description: "Start line (1-based)" })),
      endLine: Type.Optional(Type.Number({ description: "End line (1-based, inclusive)" })),
    }),
    execute: async (params): Promise<ToolCallResult> => {
      const { resolved: filePath, error } = safeResolvePath(params.filePath as string);
      if (error) return { content: error };

      if (!fs.existsSync(filePath)) {
        return { content: `File not found: ${filePath}` };
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return { content: `Not a file: ${filePath}` };
      }

      // 读取文件全部内容，按行切割
      const raw = fs.readFileSync(filePath, "utf-8");
      const lines = raw.split("\n");
      // 应用行范围选择（1-based, inclusive），默认读取全部
      const startLine = Math.max(1, (params.startLine as number) ?? 1);
      const endLine = Math.min(lines.length, (params.endLine as number) ?? lines.length);
      const selected = lines.slice(startLine - 1, endLine);
      let content = selected.join("\n");

      // 超长内容截断，防止撑爆上下文
      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS) + "\n…[truncated]";
      }

      return {
        content,
        details: { filePath, lines: lines.length, startLine, endLine },
      };
    },
  };
}

/**
 * 创建 file_write 工具 — AI 用它来写入或追加文件。
 * 自动创建不存在的父目录。
 */
export function createFileWriteTool(): ToolDefinition {
  return {
    name: "file_write",
    description: "Write content to a file. Creates parent directories if needed.",
    schema: Type.Object({
      filePath: Type.String({ description: "Absolute or relative path to the file" }),
      content: Type.String({ description: "Content to write" }),
      append: Type.Optional(Type.Boolean({ description: "Append instead of overwrite (default false)" })),
    }),
    execute: async (params): Promise<ToolCallResult> => {
      const { resolved: filePath, error } = safeResolvePath(params.filePath as string);
      if (error) return { content: error };
      const content = params.content as string;
      const append = (params.append as boolean) ?? false;

      // 确保父目录存在，不存在则递归创建
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // append=true 追加到文件末尾，否则覆写整个文件
      if (append) {
        fs.appendFileSync(filePath, content, "utf-8");
      } else {
        fs.writeFileSync(filePath, content, "utf-8");
      }

      return {
        content: `${append ? "Appended to" : "Wrote"} ${filePath} (${content.length} chars)`,
        details: { filePath, chars: content.length, append },
      };
    },
  };
}

/**
 * 创建 list_dir 工具 — AI 用它来浏览目录结构。
 * 非递归时只看当前层；递归时最多深入 3 层。
 * 自动过滤隐藏文件（.开头）和 node_modules。
 */
export function createListDirTool(): ToolDefinition {
  return {
    name: "list_dir",
    description: "List the contents of a directory.",
    schema: Type.Object({
      dirPath: Type.String({ description: "Path to the directory" }),
      recursive: Type.Optional(Type.Boolean({ description: "List recursively (default false, max 3 levels)" })),
    }),
    execute: async (params): Promise<ToolCallResult> => {
      const dirPath = path.resolve(params.dirPath as string);
      const recursive = (params.recursive as boolean) ?? false;

      if (!fs.existsSync(dirPath)) {
        return { content: `Directory not found: ${dirPath}` };
      }

      const entries = listDirectory(dirPath, recursive ? 3 : 1, 0);
      return { content: entries.join("\n") };
    },
  };
}

/**
 * 递归列出目录内容。
 * @param dirPath  - 目录绝对路径
 * @param maxDepth - 最大递归深度（1=仅当前层，3=最多三层）
 * @param depth    - 当前递归深度（用于缩进和深度限制）
 */
function listDirectory(dirPath: string, maxDepth: number, depth: number): string[] {
  if (depth >= maxDepth) return [];
  const entries: string[] = [];
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    // 过滤隐藏文件和 node_modules，减少噪音
    if (item.name.startsWith(".") || item.name === "node_modules") continue;
    const indent = "  ".repeat(depth);
    if (item.isDirectory()) {
      entries.push(`${indent}${item.name}/`);
      entries.push(...listDirectory(path.join(dirPath, item.name), maxDepth, depth + 1));
    } else {
      entries.push(`${indent}${item.name}`);
    }
  }
  return entries;
}
