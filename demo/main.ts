/**
 * Demo 入口 — 使用 WebAgent 测试浏览器端 AI Agent。
 *
 * 这个文件只负责 UI 交互，所有 Agent 逻辑由 WebAgent 类封装：
 *
 *   UI 事件 → WebAgent.chat() → 回调更新 UI
 *
 * 对比原来的 main.ts：
 * - 不再重写 agent loop、AI 调用、system prompt 构建
 * - 只需实例化 WebAgent + 绑定 callbacks + 调用 chat()
 */
import { WebAgent } from "../src/web/index.js";
import type { ToolCallResult } from "../src/core/tool-registry.js";

// ─── DOM 引用 ───
const chatEl = document.getElementById("chat")!;
const inputEl = document.getElementById("input") as HTMLInputElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const modelEl = document.getElementById("model") as HTMLSelectElement;
const dryrunEl = document.getElementById("dryrun") as HTMLInputElement;
const statusEl = document.getElementById("status")!;

// ─── 创建 Agent 实例 ───
// baseURL 使用 Vite proxy 路径，代理到 GitHub Models API
const agent = new WebAgent({ token: "", provider: "copilot", baseURL: "/api" });
agent.registerTools(); // 注册内置 Web 工具

// 显示已注册的工具
const tools = agent.getTools();
appendMsg(
  "system",
  `✅ 已注册 ${tools.length} 个 Web 工具：${tools.map((t) => t.name).join(", ")}`,
);

// ─── 绑定 Agent 回调 → 更新 UI ───
agent.callbacks = {
  onRound: (round) => {
    statusEl.textContent = `思考中 (第 ${round + 1} 轮)...`;
  },
  onText: (text) => {
    appendMsg("assistant", text);
  },
  onToolCall: (name, input) => {
    appendMsg("tool-call", `${name}(${JSON.stringify(input)})`);
    statusEl.textContent = `执行工具: ${name}...`;
  },
  onToolResult: (_name, result: ToolCallResult) => {
    const str =
      typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);
    appendMsg("tool-result", str);
  },
};

// ─── 从 localStorage 恢复 Token ───
const savedToken = localStorage.getItem("ap_token");
if (savedToken) {
  tokenEl.value = savedToken;
  statusEl.textContent = "已连接";
  statusEl.classList.add("connected");
}

// ─── 事件绑定 ───

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

tokenEl.addEventListener("change", () => {
  if (tokenEl.value) {
    localStorage.setItem("ap_token", tokenEl.value);
    statusEl.textContent = "已连接";
    statusEl.classList.add("connected");
  }
});

// 暴露给 HTML 按钮的全局函数
(window as any).sendQuick = sendQuick;
(window as any).handleSend = handleSend;

// ─── Chat UI 函数 ───

function appendMsg(type: string, text: string): HTMLElement {
  const div = document.createElement("div");
  div.className = `msg ${type}`;

  if (type === "tool-call" || type === "tool-result") {
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = type === "tool-call" ? "🔧 工具调用" : "📋 工具结果";
    div.appendChild(label);
  }

  const content = document.createElement("span");
  content.textContent = text;
  div.appendChild(content);

  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

function sendQuick(text: string) {
  inputEl.value = text;
  handleSend();
}

let running = false;

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text || running) return;

  const token = tokenEl.value.trim();
  if (!token) {
    appendMsg("error", "❌ 请先填写 GitHub Token");
    return;
  }

  running = true;
  sendBtn.disabled = true;
  inputEl.value = "";

  appendMsg("user", text);

  // 同步 UI 设置到 Agent 实例
  agent.setToken(token);
  agent.setModel(modelEl.value);
  agent.setDryRun(dryrunEl.checked);

  try {
    await agent.chat(text);
  } catch (err: any) {
    appendMsg("error", `❌ ${err.message || err}`);
  } finally {
    running = false;
    sendBtn.disabled = false;
    statusEl.textContent = "已连接";
    statusEl.classList.add("connected");
    inputEl.focus();
  }
}
