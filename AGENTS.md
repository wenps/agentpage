# AutoPilot — 项目指南（深度版）

> 浏览器内嵌 AI Agent SDK：让 AI 通过 tool-calling 操作网页。
> 本文是协作与演进指南，关注“怎么改不出错”。

## 1. 项目目标

AutoPilot 的核心不是“聊天”，而是“可控执行”：

- 用户目标被拆解为可执行子任务
- AI 仅基于当前快照做决策
- 通过工具调用驱动真实 DOM 行为
- 每轮执行后刷新快照并增量推进

一句话：**在浏览器内实现任务增量消费的 Agent Loop。**

## 2. 当前权威目录结构

```text
src/
├── core/
│   ├── index.ts
│   ├── types.ts
│   ├── tool-params.ts
│   ├── tool-registry.ts
│   ├── system-prompt.ts
│   ├── agent-loop/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── constants.ts
│   │   ├── helpers.ts
│   │   ├── snapshot.ts
│   │   ├── messages.ts
│   │   └── recovery.ts
│   └── ai-client/
│       ├── index.ts
│       ├── constants.ts
│       ├── custom.ts
│       ├── openai.ts
│       ├── anthropic.ts
│       ├── deepseek.ts
│       └── sse.ts
└── web/
  ├── index.ts
  ├── dom-tool.ts          # 兼容转发层（re-export）
  ├── navigate-tool.ts     # 兼容转发层（re-export）
  ├── page-info-tool.ts    # 兼容转发层（re-export）
  ├── wait-tool.ts         # 兼容转发层（re-export）
  ├── evaluate-tool.ts     # 兼容转发层（re-export）
  ├── ref-store.ts
  ├── messaging.ts
  └── tools/
    ├── dom-tool.ts
    ├── navigate-tool.ts
    ├── page-info-tool.ts
    ├── wait-tool.ts
    └── evaluate-tool.ts
```

## 3. 分层边界（必须遵守）

### core 层（环境无关）

职责：
- AI Provider 适配与统一响应
- Agent 主循环与恢复策略
- 工具注册与分发
- 快照消息管理

约束：
- 不依赖 DOM API
- 不引入浏览器上下文对象（window/document）
- 逻辑可在任意 JS 环境复用

### web 层（浏览器实现）

职责：
- WebAgent 入口与配置管理
- 5 个内置浏览器工具
- RefStore 哈希定位
- Extension 消息桥

约束：
- 可依赖 DOM API
- 仅向 core 提供能力，不反向污染 core

## 4. 关键运行原理

### 4.1 增量消费模型

每轮循环都做同一件事：
1. 读取最新页面快照
2. 告诉 AI：原始目标 + 已完成步骤 + 当前快照
3. 执行 AI 返回的工具调用
4. 刷新快照
5. 重复，直到 AI 返回“无工具调用的总结文本”

补充（渐进式协议）：
- 每轮消息必须显式包含：
  - 当前剩余任务文本（remaining instruction）
  - 上一轮已执行任务数组（previous round tasks）
- 模型可在文本中返回：
  - `REMAINING: <text>`（仍有剩余任务）
  - `REMAINING: DONE`（当前文本任务已消费完）

### 4.2 不跨 DOM 变化链式执行

原则：
- 当前快照可见的目标可以同轮批量执行
- 会引发结构变化的动作（如打开弹窗）执行后，必须等待下一轮新快照再继续

目标：减少“猜测未来 DOM”导致的失败与空转。

### 4.3 快照优先级

快照是当前可执行范围的唯一事实来源：
- `messages.ts` 持续注入最新快照
- `snapshot.ts` 负责包裹、去重、剥离旧快照
- `recovery.ts` 负责在失败后触发重新快照

## 5. 模块职责细化

### core/agent-loop

- `index.ts`
  - 主循环编排
  - 工具执行与结果汇总
  - 与 AIClient 和 ToolRegistry 协同

- `messages.ts`
  - 紧凑消息构建
  - 将“原始任务 + done steps + latest snapshot”压缩成固定语义结构

- `snapshot.ts`
  - 读取页面 URL/快照
  - 快照包裹与去重
  - prompt 中旧快照剥离

- `recovery.ts`
  - 冗余 page_info 拦截
  - 元素找不到后的恢复拍照
  - 导航变化检测
  - 空转检测

- `helpers.ts`
  - 工具结果识别、输入摘要、等待时间解析等纯函数

### core/ai-client

- `index.ts`：provider 路由
- `openai.ts`：OpenAI/Copilot 协议
- `anthropic.ts`：Anthropic 协议
- `deepseek.ts`：DeepSeek 协议
- `sse.ts`：SSE 统一消费器
- `custom.ts`：BaseAIClient 抽象封装

### web

- `index.ts`：WebAgent 对外 API，负责配置、记忆、autoSnapshot、callbacks
- `tools/*.ts`：工具实现主文件（DOM/导航/信息/等待/执行）
- `dom-tool.ts` / `navigate-tool.ts` / `page-info-tool.ts` / `wait-tool.ts` / `evaluate-tool.ts`：兼容转发层，避免外部导入路径断裂
- `ref-store.ts`：`#hashID -> Element` 映射
- `messaging.ts`：Extension 场景消息桥

## 6. 保护机制（系统稳定性的核心）

必须理解并保留以下机制：

1. 冗余调用拦截
- 避免 AI 无意义调用 page_info 导致 completion 浪费

2. 元素恢复机制
- 元素找不到时自动等待 + 重拍快照 + 引导重定位

3. 导航上下文更新
- URL 变化时更新 page context，避免旧映射污染

4. 空转检测
- 连续只读/无实质推进时终止循环，防止无限迭代

5. 重复批次防自转
- 若连续两轮返回完全相同的任务批次且上一轮无错误，直接终止本次请求
- 目标：避免“看起来已完成但循环不停”的重复调用

## 7. 变更策略（高优先级）

### 允许做的

- 以“最小改动”修复链路中的单点问题
- 优先增强类型与可观测性
- 在不改变外部 API 的前提下优化内部结构

### 禁止做的

- 跨层耦合（core 直接引用 DOM）
- 通过全局单例绕过 ToolRegistry 实例化设计
- 修改 recovery 语义却不更新 messages/prompt 一致性
- 以“删除快照信息”掩盖决策问题

## 8. 开发与验证

```bash
pnpm install
pnpm check
pnpm test
pnpm demo
pnpm build
```

验收要求：
- `pnpm check` 无 error
- 关键链路可在 demo 中完成一次完整任务（有工具调用、有快照更新、有最终总结）

## 9. 文档治理

- 权威架构说明：`README.md` 的“完整架构流程图（含链路）”章节
- `docs/ARCHITECTURE_FLOW.md`：可作为扩展草稿或历史版本
- 修改运行机制（loop、snapshot、recovery）时，必须同步更新 README 对应章节

## 10. 一句话协作准则

**先保证“快照-决策-执行-反馈”闭环正确，再谈优化。**

补充：对“渐进式任务消费”相关改动，必须同时维护三处一致性：
- `messages.ts` 的输入语义（remaining + previous tasks）
- `index.ts` 的停机判定（无工具调用/重复批次/错误回退）
- README/AGENTS 的机制描述

## 11. 注释与提示词语言规范

- 函数级注释（JSDoc）统一使用中英双语：
  - 第一行写“中文说明 / English summary”
  - 关键行为、约束、返回值至少给出中英对照
- 对外 Prompt 正文统一英文：
  - 发送给模型的 system/user 指令文本必须是英文
  - 中文仅用于源码注释，不应进入 prompt payload
- 改动规则：
  - 修改函数逻辑时，同步更新该函数的中英双语注释
  - 新增 core 模块导出函数时，默认要求中英双语注释
