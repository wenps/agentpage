# AutoPilot

> **浏览器内嵌 AI Agent SDK** — 让 AI 通过 tool-calling 操作你的网页。

一行代码给你的网站加上 AI Agent 能力：用户说一句话，AI 自动点击按钮、填写表单、读取数据、执行 JS。

---

## 核心特性

- **内嵌式 Agent** — 运行在页面内部，直接操作 DOM，无需截图、无需外部浏览器进程
- **零 SDK 依赖** — 使用原生 `fetch` 连接 AI，支持 OpenAI / GitHub Copilot / Anthropic
- **5 个内置工具** — DOM 操作、页面导航、页面信息、等待元素、JS 执行
- **可扩展** — 通过 `registerTool()` 添加自定义工具
- **多轮记忆** — 可开关的对话历史，Agent 能记住上下文
- **~2000 行** — 轻量、可审计、无黑箱

---

## 快速开始

### 安装

```bash
pnpm install
```

### 使用

```typescript
import { WebAgent } from "autopilot/web";

const agent = new WebAgent({
  token: "your-api-key",
  provider: "copilot",  // "copilot" | "openai" | "anthropic"
  model: "gpt-4o",
  memory: true,         // 开启多轮记忆
});

agent.registerTools();  // 注册 5 个内置 Web 工具

agent.callbacks = {
  onText: (text) => console.log("AI:", text),
  onToolCall: (name, input) => console.log("🔧", name),
};

const result = await agent.chat("把搜索框填上 'AutoPilot' 然后点搜索按钮");
console.log(result.reply);
```

### 运行 Demo

```bash
pnpm demo  # 启动 Vite 开发服务器，端口 3000
```

Demo 页面提供开箱即用的聊天 UI，可直接测试 AI 操作当前页面。

---

## 架构

```
src/
├── core/          # 🔷 共享引擎（零环境依赖，纯 TypeScript + fetch）
│   ├── types.ts           # 类型定义
│   ├── tool-registry.ts   # 工具注册表（实例化）
│   ├── agent-loop.ts      # 决策循环（ReAct 模式）
│   ├── ai-client.ts       # AI 客户端工厂（纯 fetch）
│   └── system-prompt.ts   # 系统提示词
│
├── web/           # 🌐 浏览器 Agent
│   ├── index.ts           # WebAgent 类
│   └── tools/             # 5 个 Web 工具
│       ├── dom-tool.ts        # click, fill, type, getText...
│       ├── navigate-tool.ts   # goto, back, scroll...
│       ├── page-info-tool.ts  # url, title, snapshot...
│       ├── wait-tool.ts       # waitForSelector...
│       ├── evaluate-tool.ts   # 执行任意 JS
│       ├── register.ts        # 注册入口
│       └── messaging.ts       # Chrome Extension 消息桥
│
demo/              # 🎨 演示页面
```

两层结构：`core`（引擎）+ `web`（浏览器工具），14 个源文件。

---

## 工具一览

| 工具 | 动作 | 说明 |
|------|------|------|
| **dom** | click, fill, type, get_text, get_attr, set_attr, add_class, remove_class | DOM 操作 |
| **navigate** | goto, back, forward, reload, scroll | 页面导航 |
| **page_info** | get_url, get_title, get_selection, get_viewport, snapshot, query_all | 页面信息 |
| **wait** | wait_for_selector, wait_for_hidden, wait_for_text | 等待元素变化 |
| **evaluate** | execute | 执行任意 JavaScript |

### 添加自定义工具

```typescript
import { Type } from "@sinclair/typebox";

agent.registerTool({
  name: "my_tool",
  description: "描述这个工具做什么",
  schema: Type.Object({
    param: Type.String({ description: "参数说明" }),
  }),
  async execute(params) {
    return { content: "执行结果" };
  },
});
```

---

## API

### `WebAgent`

```typescript
new WebAgent(options: WebAgentOptions)
```

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `token` | `string` | — | API Key（必填） |
| `provider` | `string` | `"copilot"` | AI 提供商 |
| `model` | `string` | `"gpt-4o"` | 模型名称 |
| `baseURL` | `string` | — | 自定义 API 端点 |
| `memory` | `boolean` | `false` | 多轮对话记忆 |
| `dryRun` | `boolean` | `false` | 只打印工具调用不执行 |
| `maxRounds` | `number` | `10` | 最大工具调用轮次 |

**方法：**

| 方法 | 说明 |
|------|------|
| `registerTools()` | 注册 5 个内置 Web 工具 |
| `registerTool(tool)` | 注册自定义工具 |
| `chat(message)` | 发送消息，返回 `AgentLoopResult` |
| `setMemory(enabled)` | 开关多轮记忆 |
| `clearHistory()` | 清空对话历史 |
| `setToken(token)` | 更新 API Key |
| `setModel(model)` | 更新模型 |
| `setProvider(provider)` | 更新提供商 |

---

## 开发

```bash
pnpm install          # 安装依赖
pnpm check            # 类型检查 + lint
pnpm demo             # 启动 Demo（端口 3000）
pnpm test             # 运行测试
```

---

## License

MIT
