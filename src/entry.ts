#!/usr/bin/env node
/**
 * AutoPilot — 极简入口。
 * 启动交互式聊天，直接进入 Agent 对话循环。
 */
import process from "node:process";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

process.title = "autopilot";

// 加载 .env（如果存在）
const envFile = path.join(process.cwd(), ".env");
if (existsSync(envFile)) config({ path: envFile });

// 直接启动交互式聊天
const { runInteractiveChat } = await import("./node/cli/interactive.js");
runInteractiveChat().catch((err: Error) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
