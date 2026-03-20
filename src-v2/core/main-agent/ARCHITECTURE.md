# MainAgent 架构设计文档

## 1. 模块定位

MainAgent 是 v2 架构的**最顶层编排者**，是唯一面向用户的入口。

它接收用户指令，决定执行策略（直接执行 or 微任务编排），
构建 systemPrompt，调度 engine 执行，汇总结果并返回给上层。

在 v2 模块层级中的位置：

```
用户 / Web 层
    ↓
 MainAgent          ← 本模块
    ↓
 engine (executeAgentLoop)
    ↓
 AI Client + Tools
```

## 2. 职责边界

### 做什么

- 接收用户自然语言指令
- 意图分析与任务拆解（简单任务 vs 复杂多步骤任务）
- 构建 systemPrompt（调用 `shared/system-prompt.buildSystemPrompt()`）
- 编排微任务执行链（MicroTaskDescriptor → engine 循环）
- 管理对话历史和上下文
- 汇总执行结果，返回给调用方

### 不做什么

- **不执行工具**：工具执行由 engine 内部驱动
- **不管理页面状态**：页面快照、DOM 操作由 web/tools 层负责
- **不直接调用 AI**：AI 交互通过 engine 封装
- **不注册工具**：工具注册表由 web 层组装后传入

## 3. 核心流程

```
用户指令
  ↓
┌─────────────────────────┐
│  1. 接收用户指令          │
│  2. 意图分析              │
│     - 简单任务？→ 直接执行 │
│     - 复杂任务？→ 任务拆解 │
└─────────────────────────┘
  ↓                    ↓
直接执行             微任务编排
  ↓                    ↓
┌──────────┐    ┌──────────────────┐
│ 构建      │    │ 拆解为            │
│ systemPrompt │    │ MicroTaskDescriptor[] │
│ + 调用    │    │ 逐个构建 prompt    │
│ engine    │    │ + 调用 engine     │
└──────────┘    │ + 断言验证        │
  ↓              │ + 结果链记录      │
  ↓              └──────────────────┘
  ↓                    ↓
┌─────────────────────────┐
│  结果汇总 & 返回          │
└─────────────────────────┘
```

## 4. 与其他模块的依赖关系

| 依赖模块 | 关系 | 说明 |
|---------|------|------|
| `shared/system-prompt` | 调用 | 构建 systemPrompt 字符串 |
| `engine/executeAgentLoop` | 调用 | 执行单轮/多轮 agent 循环 |
| `micro-task/` | 使用类型 + 工具 | MicroTaskDescriptor、ExecutionRecordChain、TaskMonitor |
| `assertion/` | 使用类型 + 工具 | AssertionConfig、断言请求构建与验证 |
| `web/tools` | 接收（由调用方传入） | ToolRegistry 实例，包含已注册的工具集 |
| `shared/types` | 使用类型 | AgentLoopParams、AgentLoopResult 等 |

依赖方向：`MainAgent → engine → AI Client + Tools`
MainAgent 不被 engine 反向依赖。

## 5. 两种执行模式

### 5.1 直接执行模式

适用于简单、单步任务（等同 v1 WebAgent.chat 行为）。

```typescript
// 伪代码
const systemPrompt = buildSystemPrompt({ extraInstructions });
const result = await executeAgentLoop({
  systemPrompt,
  instruction: userMessage,
  tools,
  aiClient,
  // ...其他参数
});
return result;
```

特点：
- 不拆解任务，直接将用户指令作为 instruction 传入 engine
- engine 内部的多轮循环处理所有交互
- 适合 "点击某个按钮"、"填写表单" 等原子操作

### 5.2 微任务编排模式

适用于复杂、多步骤任务。**已实现**（`chatWithOrchestration` + `dispatch.ts`）。

```typescript
// 实际使用
const result = await agent.chatWithOrchestration(
  "填写员工入职表单",
  [
    { id: "mt-1", task: "填写基本信息：姓名张三、性别男、年龄30" },
    { id: "mt-2", task: "填写联系方式：手机13800138000、邮箱xxx@xx.com" },
    { id: "mt-3", task: "填写地址：北京朝阳区xxx路" },
    { id: "mt-4", task: "点击提交按钮" },
  ],
  { maxRetries: 1 },
);

// 查看每个微任务结果
for (const mt of result.microTaskResults!) {
  console.log(`${mt.descriptor.id}: ${mt.success ? "✅" : "✗"}`);
}
```

内部流程：
1. `chatWithOrchestration` 初始化 `TaskMonitor`
2. 逐个执行微任务（`TaskMonitor.execute` → `executeMicroTask` → `executeAgentLoop`）
3. 每个微任务使用 `buildMicroTaskPrompt` 构建精简 prompt + `previouslyCompleted` 上下文
4. 失败的微任务尝试重试（最多 `maxRetries` 次）
5. 全部完成后返回 `MainAgentResult`（含 `microTaskResults[]`）

特点：
- 将复杂目标拆解为 MicroTaskDescriptor 链
- 每个微任务独立调用 engine，拥有定制化的精简 systemPrompt（`micro-task/prompt.ts`）
- 通过 ExecutionRecordChain 记录执行历史，供后续微任务参考
- 每个微任务可配置独立的断言验证
- TaskMonitor 监控整体进度

涉及文件：
- `main-agent/index.ts` — `chatWithOrchestration()` 编排入口
- `main-agent/dispatch.ts` — `executeMicroTask()` 串联 prompt + engine
- `micro-task/prompt.ts` — `buildMicroTaskPrompt()` 精简提示词
- `micro-task/task-monitor.ts` — TaskMonitor 执行记录链管理
- `micro-task/record.ts` — ExecutionRecordChain 实现

## 6. 接口设计草案

```typescript
interface MainAgentOptions {
  /** AI 客户端实例 */
  aiClient: AIClient;
  /** 工具注册表（由 web 层组装后传入） */
  tools: ToolRegistry;
  /** 额外的 systemPrompt 指令（扩展注册等） */
  extraInstructions?: string[];
  /** 断言配置 */
  assertionConfig?: AssertionConfig;
  /** 最大轮数（传递给 engine） */
  maxRounds?: number;
}

class MainAgent {
  constructor(options: MainAgentOptions);

  /**
   * 执行用户指令。
   * 内部自动判断执行模式（直接 vs 编排）。
   */
  chat(message: string): Promise<MainAgentResult>;

  /**
   * 追加额外指令到 systemPrompt。
   * 适用于 web 层在运行时动态注册扩展。
   */
  addExtraInstruction(instruction: string): void;

  /**
   * 获取对话历史。
   */
  getHistory(): ConversationEntry[];
}
```

## 7. 状态管理

MainAgent 维护以下状态：

| 状态 | 生命周期 | 说明 |
|------|---------|------|
| 对话历史 | 实例级 | 用户指令 + AI 响应的完整记录 |
| 任务进度 | 单次 chat 调用 | 微任务编排模式下的 ExecutionRecordChain |
| extraInstructions | 实例级 | 可动态追加的额外指令列表 |
| assertionConfig | 实例级 | 断言配置（可在构造时或运行时设置） |

状态不跨实例共享。每个 MainAgent 实例代表一个独立的 agent 会话。

## 8. 与 v1 WebAgent 的关系

### 继承

- **核心循环**：v1 的 `agentLoop()` → v2 的 `executeAgentLoop()`（已迁移至 engine）
- **systemPrompt 构建**：v1 的 `buildSystemPrompt()` → v2 原样迁移至 shared
- **工具执行**：v1 的工具体系 → v2 ToolRegistry（已迁移至 shared）

### 重新设计

- **编排能力**：v1 无任务拆解，MainAgent 新增微任务编排模式
- **断言集成**：v1 断言为外部附加，MainAgent 内置断言流程
- **职责分离**：v1 WebAgent 同时负责页面管理 + AI 交互 + 工具执行，
  v2 拆分为 MainAgent（编排）+ engine（循环）+ web/tools（工具）
- **状态管理**：v1 状态散落在 WebAgent 各属性中，
  v2 明确定义状态边界和生命周期
