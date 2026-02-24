/**
 * 交互式聊天循环 — 用户通过终端与 Agent 对话。
 *
 * 流程极简：
 *   you > 用户输入
 *   autopilot > AI 回复
 *
 * 【后续可拓展】
 * - 添加进度指示器（spinner）
 * - 支持多行输入
 * - 支持命令历史
 * - 支持 /help /clear 等内置命令
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AIMessage } from "../../core/types.js";
import { runAgent } from "../index.js";
import { loadConfig } from "../config.js";

export async function runInteractiveChat(): Promise<void> {
  const config = loadConfig();

  // dry-run 开关：输入 /dry 切换
  let dryRun = false;
  // 多轮记忆开关：输入 /memory 切换
  let memory = false;
  // 对话历史（memory 开启时累积）
  let history: AIMessage[] = [];

  console.log("\n\ud83e\udd16 AutoPilot Interactive Mode");
  console.log("Type a message to chat. Type 'exit' or Ctrl+C to quit.");
  console.log("Commands: /dry (toggle dry-run) | /memory (toggle memory) | /clear (clear history)\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    while (true) {
      const input = await rl.question("you > ");
      const message = input.trim();
      if (!message) continue;
      if (message === "exit" || message === "quit") break;

      // 内置命令：切换 dry-run 模式
      if (message === "/dry") {
        dryRun = !dryRun;
        console.log(`\n\ud83d\udd27 Dry-run mode: ${dryRun ? "ON\uff08\u5de5\u5177\u53ea\u6253\u5370\u4e0d\u6267\u884c\uff09" : "OFF\uff08\u6b63\u5e38\u6267\u884c\uff09"}\n`);
        continue;
      }

      // 内置命令：切换多轮记忆
      if (message === "/memory") {
        memory = !memory;
        if (!memory) history = [];
        console.log(`\n\ud83e\udde0 Memory: ${memory ? "ON\uff08\u5df2\u5f00\u542f\u591a\u8f6e\u8bb0\u5fc6\uff09" : "OFF\uff08\u5df2\u5173\u95ed\uff0c\u5386\u53f2\u5df2\u6e05\u7a7a\uff09"}\n`);
        continue;
      }

      // 内置命令：清空对话历史
      if (message === "/clear") {
        history = [];
        console.log("\n\ud83d\uddd1\ufe0f  \u5bf9\u8bdd\u5386\u53f2\u5df2\u6e05\u7a7a\n");
        continue;
      }

      try {
        const result = await runAgent({
          message,
          provider: config.agent?.provider ?? "copilot",
          model: config.agent?.model,
          config,
          dryRun,
          history: memory ? history : undefined,
        });

        // 记忆模式：累积对话历史
        if (memory) {
          history = result.messages;
        }

        console.log(`\nautopilot > ${result.reply}\n`);
        if (result.toolCalls.length > 0) {
          console.log(`  [${result.toolCalls.length} tool call(s)]`);
        }
      } catch (err) {
        console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
