/**
 * 工具注册入口 — 将所有内置工具注册到 tool-registry。
 *
 * 新增工具只需：
 *   1. 创建 xxx-tool.ts 实现 ToolDefinition
 *   2. 在这里 import 并 registerTool()
 *
 * 【后续可拓展】
 * - 添加自定义工具加载器（从插件目录动态加载）
 */
import { ToolRegistry } from "../../core/tool-registry.js";
import { createExecTool } from "./exec-tool.js";
import { createBrowserTool } from "./browser-tool.js";
import { createWebFetchTool } from "./web-fetch-tool.js";
import { createWebSearchTool } from "./web-search-tool.js";
import { createFileReadTool, createFileWriteTool, createListDirTool } from "./file-tools.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(createExecTool());       // Shell 命令执行
  registry.register(createBrowserTool());    // 浏览器自动化（Playwright）
  registry.register(createWebFetchTool());   // 网页内容抓取
  registry.register(createWebSearchTool());  // 网页搜索
  registry.register(createFileReadTool());   // 文件读取
  registry.register(createFileWriteTool());  // 文件写入
  registry.register(createListDirTool());    // 目录浏览
}
