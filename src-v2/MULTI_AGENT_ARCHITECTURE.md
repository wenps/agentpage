# Multi-Agent Architecture Design

> 从单一 Agent 到多 Agent 协作：通过微任务聚焦执行 + 断言驱动渐进消费，解决当前系统"一个 Agent 扛所有"的压力问题。

---

## 1. 问题分析

### 1.1 现状痛点

当前 `src/core` 采用**单 Agent + 统一 Prompt** 架构：

```
┌──────────────────────────────────────────────┐
│            Single Agent Loop                 │
│                                              │
│  system-prompt.ts (统一 prompt)              │
│  ├── 核心规则 (32条)                          │
│  ├── 事件信号                                 │
│  ├── 输出协议 (REMAINING)                     │
│  ├── 断言能力                                 │
│  ├── 任务分解                                 │
│  └── 页面操作 + 导航 + 恢复 + 保护...         │
│                                              │
│  → 一个 AI 同时负责：                         │
│    ✗ 理解复杂任务                             │
│    ✗ 分解子步骤                               │
│    ✗ 执行 DOM 操作                            │
│    ✗ 判断进度                                 │
│    ✗ 决定完成时机                             │
│    ✗ 触发/评估断言                            │
└──────────────────────────────────────────────┘
```

**核心问题：**

| 问题 | 描述 |
|------|------|
| **Prompt 过载** | 单个 system prompt 塞入所有职责规则，AI 注意力被稀释，容易遗漏关键规则 |
| **职责耦合** | 任务编排、DOM 操作、完成判定混在同一个上下文，互相干扰 |
| **上下文膨胀** | 复杂任务的完整对话历史随轮次增长，token 浪费在非当前步骤的信息上 |
| **大表单灾难** | 一个页面字段很多时，AI 要同时记住所有字段的操作规则 + 已填/未填状态 + 全局任务进度，容易遗漏 |
| **断言不独立** | 断言虽然用了独立 AI 调用，但触发时机依赖执行 AI 的主观判断 |
| **恢复困难** | 单 Agent 陷入死循环时，没有外部监督者能介入修正 |

### 1.2 设计目标

- **聚焦执行**：每个微任务只关注一小块工作，prompt 更精简，上下文更干净
- **渐进消费**：任务通过微任务链逐步消费，每完成一个就沉淀执行记录，驱动下一步
- **断言串联**：微任务完成后，执行记录 + 任务描述一起喂给断言，断言结果生成下一阶段上下文
- **执行引擎统一**：Main Agent 和 Micro-task Agent 共享同一套执行机制（工具、保护、重试）
- **Main Agent 也能直接操作**：常规简单工作 Main Agent 直接干，不必事事都拆微任务

---

## 2. 核心设计原则：聚焦执行 + 渐进消费

### 2.1 微任务的本质价值

微任务的价值**不是**"处理复杂性"，而是**聚焦**：

```
当前系统的问题 —— 一个大表单（20个字段）：

  单 Agent 需要：
  ├── 在 prompt 里带着全部 32 条规则
  ├── 在上下文里记住 20 个字段的填写要求
  ├── 跟踪哪些已填、哪些未填
  ├── 维护全局 REMAINING（很长）
  └── 同时关注所有这些 → 注意力稀释 → 遗漏字段

微任务方案：

  MT-1: "填写基本信息区域：姓名张三、性别男、年龄30"
    → prompt 只关注 3 个字段
    → 上下文干净
    → 完成后记录：✅ 姓名=张三, 性别=男, 年龄=30

  MT-2: "填写联系方式区域：手机13800138000、邮箱xxx@xx.com"
    → prompt 只关注 2 个字段
    → 前一个微任务的执行记录已沉淀
    → 完成后记录：✅ 手机=13800138000, 邮箱=xxx@xx.com

  MT-3: "填写地址区域：省份北京、城市朝阳区、详细地址xxx"
    → ...

  每一个微任务都更容易成功，因为它只需要关注一小块。
```

### 2.2 断言驱动的渐进消费

微任务不是孤立执行的，它们通过**断言**形成一条链：

```
┌──────────────────────────────────────────────────────────────┐
│                    渐进消费链                                  │
│                                                              │
│  Main Agent 分解任务                                          │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────┐   执行记录   ┌─────────┐   执行记录   ┌────────┐│
│  │ MT-1    │ ──────────► │ 断言    │ ──────────► │ MT-2   ││
│  │ 执行    │  + 任务描述  │ 判定    │  生成下一阶段 │ 执行   ││
│  └─────────┘             │ + 沉淀  │  的上下文    └────────┘│
│                          └─────────┘                        │
│                                         │                    │
│                                         ▼                    │
│                               ┌─────────────┐               │
│                               │  断言判定    │               │
│                               │  + 沉淀      │               │
│                               └──────┬──────┘               │
│                                      │                       │
│                                      ▼                       │
│                               ┌─────────────┐               │
│                               │   MT-3      │               │
│                               │   执行       │               │
│                               └──────┬──────┘               │
│                                      │                       │
│                                      ▼                       │
│                               ┌─────────────┐               │
│                               │ 系统断言     │               │
│                               │ (全部记录)   │               │
│                               └─────────────┘               │
│                                                              │
│  每一步的输出 = 下一步的输入                                    │
│  任务越做越少，已完成记录越积越多                                │
│  最终系统断言拿到全部执行记录做整体验证                          │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Main Agent 也有执行能力

Main Agent 不是纯调度者。对于**常规简单操作**，Main Agent 直接执行，不需要拆微任务：

```
Main Agent 的决策：
├── 点击一个按钮 → 自己干
├── 填 2-3 个字段 → 自己干
├── 简单导航 → 自己干
├── 大表单 20 个字段 → 拆微任务，每个负责一个区域
├── 跨页面多步操作 → 拆微任务，每个负责一个页面的工作
└── 重复性批量操作 → 拆微任务
```

**关键**：Main Agent 和 Micro-task Agent 共享同一套执行引擎（工具、保护、重试机制），区别只在 prompt 和作用域。

---

## 3. 架构总览

```
                     ┌─────────────────────────────┐
                     │     User Task (原始任务)      │
                     └──────────────┬──────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────┐
                │            Main Agent                 │
                │       (分析 + 分解 + 可直接执行)       │
                │                                       │
                │  ① 分析任务，生成微任务列表              │
                │  ② 简单部分自己直接执行                  │
                │  ③ 需要聚焦的部分分派微任务              │
                │  ④ 收集执行记录，驱动断言               │
                │  ⑤ 断言结果生成下一阶段上下文            │
                │  ⑥ 全部完成后触发系统断言               │
                └───────────┬───────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │    微任务串行执行链            │
              │                             │
              │  MT-1 → 记录 → 断言          │
              │           ↓                 │
              │  MT-2 → 记录 → 断言          │
              │           ↓                 │
              │  MT-3 → 记录 → 断言          │
              │           ↓                 │
              │         ...                 │
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │       系统断言               │
              │  (全部执行记录 + 初始/最终    │
              │   快照 → 整体任务是否完成)    │
              └─────────────────────────────┘
```

---

## 4. 统一执行引擎

### 4.1 核心思想：一个引擎，两种模式

Main Agent 和 Micro-task Agent **不是两套代码**，而是**同一个 ExecutionEngine 的两种运行配置**：

```typescript
/**
 * 统一执行引擎 —— Main Agent 和 Micro-task Agent 共享。
 *
 * 相同的：工具集、保护机制、快照驱动循环、重试逻辑
 * 不同的：Prompt、maxRounds、可用工具白名单
 */
interface ExecutionEngine {
  /** 完全相同的工具集 */
  tools: ToolRegistry;        // dom, navigate, page_info, wait, evaluate

  /** 完全相同的保护机制 */
  recovery: RecoveryEngine;   // 元素恢复、无效点击拦截、循环检测...

  /** 完全相同的快照驱动循环 */
  loop: AgentLoop;            // snapshot → AI → tools → snapshot → ...
}

/**
 * 运行配置 —— 区分 Main 和 Micro-task 的唯一差异点。
 */
interface AgentConfig {
  role: "main" | "micro-task";

  /** 不同角色用不同 prompt */
  prompt: string;

  /** main=40, micro-task=15 */
  maxRounds: number;

  /**
   * 工具白名单
   * main: DOM 工具 + navigate + dispatch_micro_task + assert
   * micro-task: DOM 工具 + (可选 navigate) + micro_assert
   */
  enabledTools: string[];

  /** main=true, micro-task=false */
  canDispatch: boolean;
}
```

### 4.2 对比示意

```
ExecutionEngine
  │
  ├── 以 Main 模式运行
  │   prompt       = Main Prompt (DOM 操作规则 + 调度能力 + REMAINING 协议)
  │   enabledTools = [dom, navigate, page_info, wait, evaluate,
  │                   dispatch_micro_task, assert]
  │   maxRounds    = 40
  │   canDispatch  = true
  │
  └── 以 Micro-task 模式运行
      prompt       = Micro-task Prompt (只有 DOM 操作规则，更精简聚焦)
      enabledTools = [dom, page_info, wait, evaluate, micro_assert]
      maxRounds    = 15
      canDispatch  = false
```

---

## 5. 各 Agent 详细设计

### 5.1 Main Agent（主流程 Agent）

#### 5.1.1 职责定义

Main Agent 是**指挥官 + 执行者**，既能自己操作，又能分派微任务。

| 能力 | 说明 |
|------|------|
| DOM 操作 | click / fill / type / select_option / check — 常规操作直接自己干 |
| 页面导航 | navigate.goto / back / forward / reload |
| 任务分解 | 将任务拆分为微任务列表 |
| 微任务分派 | 通过 `dispatch_micro_task` 工具分派执行 |
| 记录收集 | 收集微任务执行记录，构建断言上下文 |
| 进度跟踪 | 通过 REMAINING 协议增量消费 |
| 系统断言 | 全部完成后触发 `assert({})` |

#### 5.1.2 Prompt 设计

```
## Main Agent System Prompt

You are AutoPilot, an AI agent controlling the current web page via tools.

## Core Rules
(继承现有 system-prompt.ts 的核心 DOM 操作规则)
- Original Goal Anchor ...
- Use #hashID from snapshot ...
- Batch fill/type/select freely; click ends the round ...
- Effect check ...
- ... (与现有一致)

## Execution Strategy
You can execute tasks in two ways:
1. DIRECT: For simple, routine operations (click a button, fill 2-3 fields,
   simple navigation) — execute directly using DOM tools
2. MICRO-TASK: For tasks that benefit from focused execution — dispatch
   micro-tasks that each handle a specific part of the work

### When to use micro-tasks:
- Large forms with many fields → split by section/area
- Multi-page workflows → one micro-task per page's operations
- Repetitive batch operations → micro-task for the repetitive part
- Any time the AI's attention would be diluted by too many simultaneous concerns

### Micro-task design principles:
- Each micro-task focuses on ONE specific area/section of work
- Describe the task with clear, specific scope
- After each micro-task completes, you receive its execution record
- The execution record feeds into assertions and next-task context

## REMAINING Protocol
- Each round: REMAINING: <what's left> or REMAINING: DONE
- As micro-tasks complete, their execution records accumulate
- REMAINING naturally shrinks as work is consumed
- When all work is done, trigger assert({}) for final verification

## Assertion Capability
(与现有一致)
```

#### 5.1.3 任务分解示例

```
用户: "填写这个员工入职表单，基本信息张三/男/30岁，
      联系方式13800138000/xxx@xx.com，
      地址北京朝阳区xxx路，
      紧急联系人李四/13900139000"

Main Agent 分析:
  这个表单字段很多，如果一次性填完，AI 需要同时跟踪很多字段
  → 按区域拆成微任务，每个微任务只关注一个表单区域

  MT-1: "填写基本信息区域：姓名张三、性别男、年龄30"
  MT-2: "填写联系方式区域：手机13800138000、邮箱xxx@xx.com"
  MT-3: "填写地址区域：省份北京、区朝阳区、详细地址xxx路"
  MT-4: "填写紧急联系人区域：姓名李四、电话13900139000"

  每个微任务的 prompt 只需要关注 2-3 个字段 → 高度聚焦 → 容易成功
```

---

### 5.2 Micro-task Agent（微任务 Agent）

#### 5.2.1 职责定义

Micro-task Agent 是**聚焦的执行者**，只看到自己负责的那一小块工作。

| 能力 | 说明 |
|------|------|
| DOM 操作 | click / fill / type / select_option / check 等 |
| 等待 | wait_for_selector / wait_for_stable |
| 页面查询 | get_url / get_title / query_all / get_viewport |
| 脚本执行 | evaluate / define_function |

**不能做的事（通过 enabledTools 控制）：**
- 不能分派子任务（没有 dispatch_micro_task 工具）
- 默认不能页面跳转（Main Agent 可以按需开放 navigate）

#### 5.2.2 Prompt 设计

```
## Micro-task System Prompt

You are a Micro-task Agent of AutoPilot.
You execute ONE specific task on the current page via DOM tools.

### Your task:
{task_description}

### Previously completed:
{execution_records_from_prior_micro_tasks}

### Core rules:
- Use #hashID from snapshot as selector
- Only interactive elements carry #hashID
- Click signals: clk/pdn/mdn/onclick/native button/role=button
- Batch fill/type/select freely; click ends the round
- Effect check: verify previous action worked before new actions
- Completion = visible outcome in snapshot
- Focus ONLY on your assigned task — ignore other parts of the page

### Listener Abbrevs
{与 Main Agent 一致}

### Output
Tool calls + one text line: REMAINING: <new remaining> or REMAINING: DONE
```

> **关键差异**：Micro-task Prompt 去掉了调度规则、复杂度评估等战略层内容。
> 并且注入了 `Previously completed` — 之前微任务的执行记录，让当前微任务知道什么已经做过了。

#### 5.2.3 执行记录

每个微任务完成后，产出一份**执行记录**：

```typescript
interface MicroTaskExecutionRecord {
  /** 微任务 ID */
  id: string;
  /** 任务描述 */
  task: string;
  /** 是否成功 */
  success: boolean;
  /** 具体执行了什么操作（工具调用摘要） */
  actions: string[];
  /** AI 的完成总结 */
  summary: string;
  /** 断言结果（如有） */
  assertionResult?: AssertionResult;
}
```

**示例：**

```
MT-1 执行记录:
  task: "填写基本信息区域：姓名张三、性别男、年龄30"
  success: true
  actions:
    - fill #name "张三"
    - select_option #gender "男"
    - fill #age "30"
  summary: "基本信息区域已填写完成：姓名=张三，性别=男，年龄=30"
```

#### 5.2.4 生命周期

```
┌─────────────────────────────────────────────────┐
│              Micro-task Lifecycle                │
│                                                 │
│  ┌──────────┐                                   │
│  │  INIT    │ ← 接收：                          │
│  │          │   - 任务描述                       │
│  │          │   - 当前快照                       │
│  │          │   - 之前的执行记录（上下文）         │
│  └────┬─────┘                                   │
│       │                                         │
│       ▼                                         │
│  ┌──────────┐                                   │
│  │ EXECUTE  │ ← 多轮执行循环（同一个引擎）       │
│  │          │   每轮：snapshot → AI → tools      │
│  │          │   prompt 只包含自己这块的规则       │
│  └────┬─────┘                                   │
│       │                                         │
│       ├── REMAINING: DONE                       │
│       │   │                                     │
│       │   ▼                                     │
│       │   生成执行记录                           │
│       │   │                                     │
│       │   ▼                                     │
│       │   COMPLETE → 回报 Main Agent             │
│       │   (执行记录 + 最终快照)                   │
│       │                                         │
│  保护机制（与 Main Agent 完全相同）：              │
│  - 元素恢复 / 无效点击拦截 / 循环检测              │
│  - 空闲检测 / 最大轮次限制（默认 15 轮）           │
└─────────────────────────────────────────────────┘
```

---

### 5.3 Assertion Agent（断言 Agent）

#### 5.3.1 在渐进消费中的角色

Assertion Agent 不仅是"验证者"，更是**流水线的质量关卡**——它与微任务执行**异步并行**，成功时不阻塞，失败时触发重新执行（不是回滚，是在当前 DOM 状态下重新执行该微任务，由 AI 根据当前快照和 `completedSubGoals` 判断哪些目标已完成、哪些还缺失，跳过已完成部分继续补全）。

```
核心机制：执行与断言的异步流水线

  MT-1 完成瞬间
    │
    ├──► [立即] 生成变更快照（几百ms内捕获）
    │         → 异步发给断言 AI 判定
    │
    └──► [同时] MT-2 开始执行（不等待 MT-1 断言结果）
              │
              │    ┌─────────────────────────────────┐
              │    │ MT-1 断言结果回来了              │
              │    │                                 │
              │    │ PASSED → 不管它，正常记录        │
              │    │                                 │
              │    │ FAILED → 等 MT-2 执行完          │
              │    │          → 阻塞                  │
              │    │          → 重新执行 MT-1          │
              │    │           （传入 completedSubGoals│
              │    │            AI 自行识别未完成部分） │
              │    │          → 重新断言 MT-1          │
              │    │          → 通过后才继续           │
              │    └─────────────────────────────────┘
```

#### 5.3.2 异步断言流水线设计

```
时间轴 ──────────────────────────────────────────────────────►

[执行层]  MT-1执行... │完成│  MT-2执行...  │完成│  MT-3执行...  │完成│
                      │    │              │    │              │    │
[断言层]              │    │              │    │              │    │
                      └►快照             └►快照              └►快照
                        │                  │                  │
                        ▼                  ▼                  ▼
                    assert MT-1        assert MT-2        assert MT-3
                    (异步)             (异步)              (异步)
                        │                  │                  │
                        ▼                  ▼                  ▼
                    ✅ PASS            ✅ PASS             ✅ PASS
                    (不阻塞)           (不阻塞)            (不阻塞)

                    ──── Happy Path：断言全部异步通过，零阻塞 ────


[执行层]  MT-1执行... │完成│  MT-2执行...  │完成│  ← 阻塞！等MT-1重试
                      │    │              │    │
[断言层]              └►快照              │    │
                        │                 │    │
                        ▼                 │    │
                    assert MT-1           │    │
                    (异步)                │    │
                        │                 │    │
                        ▼                 │    │
                    ✗ FAIL ───────────────┘    │
                        │                      │
                        ▼                      │
                    等 MT-2 完成               │
                        │                      │
                        ▼                      │
                    重新执行 MT-1 ──► 重新断言      │
                        │                      │
                        ▼                      │
                    ✅ PASS                     │
                        │                      │
                        ▼                      ▼
                    继续 MT-3 ──────────► assert MT-2 (异步)
                                         + MT-3 执行
```

#### 5.3.3 断言快照捕获

```
微任务完成的瞬间（几百毫秒内）：

  1. 微任务 Agent 输出 REMAINING: DONE
  2. 框架立即捕获"变更快照" ← 关键时间窗口
     - 此时页面可能还有 toast 提示、loading 状态、动画等瞬态信息
     - 这些瞬态信息是断言的重要证据（如"保存成功"提示）
  3. 将变更快照 + 微任务初始快照 + 执行记录 打包
  4. 异步发送给断言 AI
  5. 不等待结果，立即开始下一个微任务
```

#### 5.3.4 Prompt 设计

```
## Assertion System Prompt

You are a verification judge for AutoPilot.

### Input:
- INITIAL snapshot (before this micro-task started)
- POST-COMPLETION snapshot (captured immediately when micro-task finished,
  may contain transient success messages or loading states)
- Micro-task description (what was supposed to be done)
- Execution record (what actions were taken)

### Rules:
- Compare INITIAL with POST-COMPLETION to detect changes
- Transient UI states (toast, success message) in POST-COMPLETION
  are valid evidence of completion
- For each assertion condition:
  - Creation: new items not in initial = success
  - Modification: changed values = success
  - State: visual state matches description = success
- Return JSON: [{task, passed, reason}, ...]

### You have NO tools. You ONLY judge based on provided evidence.
```

#### 5.3.5 系统断言的前提条件

```
系统断言（最终验证整体任务）的触发条件：

  ✓ 所有微任务都已执行完成
  ✓ 所有微任务的断言都已通过（包括重试后通过的）
  ✓ 此时才允许 Main Agent 调用 assert({}) 触发系统断言

  如果有任何微任务的断言仍在 pending 或 failed：
  → 不允许系统断言
  → 必须先解决失败的微任务断言
```

---

## 6. 执行记录链与渐进消费

### 6.1 核心机制

这是整个架构的**核心创新点**：微任务不是孤立执行的，而是通过执行记录链形成渐进消费。

```typescript
/**
 * 执行记录链 —— 贯穿整个任务生命周期。
 *
 * 每个微任务完成后，其执行记录被追加到链中。
 * 下一个微任务启动时，收到之前所有的执行记录作为上下文。
 * 最终系统断言时，收到完整的执行记录链作为证据。
 */
interface ExecutionRecordChain {
  /** 全部已完成微任务的执行记录 */
  records: MicroTaskExecutionRecord[];

  /** 追加一条新记录 */
  append(record: MicroTaskExecutionRecord): void;

  /** 生成"Previously completed"上下文（给下一个微任务的 prompt） */
  buildPreviousContext(): string;

  /** 生成完整证据摘要（给系统断言） */
  buildEvidenceSummary(): string;
}
```

### 6.2 渐进消费流程

```
用户任务: "填写员工入职表单（基本信息+联系方式+地址+紧急联系人），然后提交"

═══════════════════════════════════════════════════════════════
阶段 1：Main Agent 分析 + 分解
═══════════════════════════════════════════════════════════════

Main Agent 看快照 → 表单很大，字段多
生成微任务列表:
  MT-1: 填写基本信息（姓名/性别/年龄）
  MT-2: 填写联系方式（手机/邮箱）
  MT-3: 填写地址（省/市/详细地址）
  MT-4: 填写紧急联系人（姓名/电话）
  MT-5: 点击提交按钮

执行记录链: []
REMAINING: MT-1 → MT-2 → MT-3 → MT-4 → MT-5

═══════════════════════════════════════════════════════════════
阶段 2：MT-1 执行
═══════════════════════════════════════════════════════════════

[Micro-task #1]
  prompt 注入:
    Your task: "填写基本信息：姓名张三、性别男、年龄30"
    Previously completed: (无)

  执行:
    Round 1: fill #name "张三" → select_option #gender "男" → fill #age "30"
    Round 2: REMAINING: DONE

  生成执行记录:
    { task: "填写基本信息", success: true,
      actions: ["fill #name 张三", "select_option #gender 男", "fill #age 30"],
      summary: "基本信息已填写：姓名=张三，性别=男，年龄=30" }

执行记录链: [MT-1✅]
REMAINING: MT-2 → MT-3 → MT-4 → MT-5

═══════════════════════════════════════════════════════════════
阶段 3：MT-2 执行（带上之前的记录）
═══════════════════════════════════════════════════════════════

[Micro-task #2]
  prompt 注入:
    Your task: "填写联系方式：手机13800138000、邮箱xxx@xx.com"
    Previously completed:
      ✅ 基本信息已填写：姓名=张三，性别=男，年龄=30

  执行:
    Round 1: fill #phone "13800138000" → fill #email "xxx@xx.com"
    Round 2: REMAINING: DONE

  生成执行记录:
    { task: "填写联系方式", success: true,
      actions: ["fill #phone 13800138000", "fill #email xxx@xx.com"],
      summary: "联系方式已填写：手机=13800138000，邮箱=xxx@xx.com" }

执行记录链: [MT-1✅, MT-2✅]
REMAINING: MT-3 → MT-4 → MT-5

═══════════════════════════════════════════════════════════════
阶段 4-5：MT-3, MT-4 类似执行...
═══════════════════════════════════════════════════════════════

执行记录链: [MT-1✅, MT-2✅, MT-3✅, MT-4✅]
REMAINING: MT-5

═══════════════════════════════════════════════════════════════
阶段 6：MT-5 提交（可能 Main Agent 直接干）
═══════════════════════════════════════════════════════════════

Main Agent 判断：点击提交就一个按钮，自己干
  → click #submit-btn
  → 等待结果

执行记录链: [MT-1✅, MT-2✅, MT-3✅, MT-4✅, Main直接执行✅]
REMAINING: 很短 → 触发 assert({})

═══════════════════════════════════════════════════════════════
阶段 7：系统断言（拿到完整执行记录链）
═══════════════════════════════════════════════════════════════

[Assertion Agent]
  输入:
    - 初始快照（空表单）
    - 最终快照（提交后页面）
    - 完整执行记录链:
        ✅ 基本信息：姓名=张三，性别=男，年龄=30
        ✅ 联系方式：手机=13800138000，邮箱=xxx@xx.com
        ✅ 地址：北京朝阳区xxx路
        ✅ 紧急联系人：李四/13900139000
        ✅ 已点击提交

  判定: 表单是否已正确提交？
  → ALL PASSED ✅

stopReason: "assertion_passed"
```

### 6.3 为什么执行记录链很重要

```
没有记录链：
  MT-3 执行时 → 不知道前面做了什么 → 可能重复填写 → 浪费轮次
  系统断言时 → 只能看快照 → 不知道中间过程 → 判定不准确

有记录链：
  MT-3 执行时 → 知道 "基本信息和联系方式已填好" → 直接去地址区域
  系统断言时 → 有完整的操作证据 → 判定更准确
  Main Agent → 看到累积记录 → 知道整体进度 → REMAINING 自然收敛
```

---

## 7. 完整执行流程示例

### 7.1 简单任务 — Main Agent 直接执行

```
用户: "点击保存按钮"

[Main Agent] Round 1:
  简单操作，自己干
  → click #save-btn
  → REMAINING: DONE → assert({})

零微任务开销，和现有系统行为一致
```

### 7.2 大表单 — 微任务聚焦执行

```
用户: "填写这个注册表单，信息如下：..."（20个字段）

[Main Agent] Round 1:
  看快照 → 表单很大，字段分布在多个区域
  分解为微任务，每个负责一个区域（如上节示例）
  → dispatch_micro_task(MT-1)
  → REMAINING: MT-1 → MT-2 → MT-3 → MT-4 → 提交

[MT-1] 聚焦执行 + 完成 → 执行记录沉淀

[Main Agent] Round 2:
  收到 MT-1 结果 + 执行记录
  → dispatch_micro_task(MT-2)（携带 MT-1 的执行记录）
  → REMAINING: MT-2 → MT-3 → MT-4 → 提交

... 逐个执行 ...

[Main Agent] Round 5:
  所有微任务完成，自己点击提交
  → click #submit
  → assert({})（带完整执行记录链）

[Assertion] 基于完整记录链 + 前后快照判定 → PASSED ✅
```

### 7.3 跨页面操作 — 每个页面一个微任务

```
用户: "进入用户管理编辑张三手机号，然后去权限页面给张三加管理员权限"

[Main Agent] Round 1:
  跨页面操作，拆微任务
  先自己导航 → click #sidebar-users
  → REMAINING: 编辑手机号 → 加权限

[Main Agent] Round 2:
  → dispatch_micro_task("找到张三，编辑手机号为13800138000，保存")
  → REMAINING: 编辑手机号 → 加权限

[MT-1] 执行完成
  执行记录: "已将张三手机号改为13800138000并保存成功"

[Main Agent] Round 3:
  自己导航到权限页面 → click #sidebar-permissions
  → REMAINING: 加权限

[Main Agent] Round 4:
  → dispatch_micro_task("找到张三，添加管理员权限")
  （MT-2 的 prompt 中包含: Previously completed: ✅ 已修改张三手机号）
  → REMAINING: 加权限

[MT-2] 执行完成
  执行记录: "已给张三添加管理员权限"

[Main Agent] Round 5:
  → assert({})（记录链: [修改手机号✅, 添加权限✅]）
  → REMAINING: DONE

[Assertion] → PASSED ✅
```

### 7.4 再规划场景

```
[Main Agent] dispatch_micro_task(MT-2)
[MT-2] 执行失败 → 重试 → 再次失败
  failureReason: "权限页面需要先选择部门，但没找到部门选择器"

[Main Agent] 收到失败 + 当前快照 + 执行记录
  → 重新评估：需要先选择部门
  → 自己操作：select_option #department "技术部"
  → 重新分派：dispatch_micro_task("在当前部门下找到张三，添加管理员权限")

控制权回到 Main Agent，它基于当前状态灵活决策
```

---

## 8. Task Monitor + dispatch 实现

### 8.1 Task Monitor

```typescript
/**
 * 微任务监听器 —— 管理执行记录链 + 驱动微任务执行。
 */
interface TaskMonitor {
  /** 执行记录链 */
  recordChain: ExecutionRecordChain;

  /** 执行单个微任务 */
  execute(descriptor: MicroTaskDescriptor): Promise<MicroTaskResult>;
}
```

### 8.2 dispatch_micro_task 工具

```typescript
/**
 * 当 Main Agent 调用 dispatch_micro_task 时：
 * 1. 从执行记录链获取 "Previously completed" 上下文
 * 2. 构建 Micro-task Prompt（任务描述 + 之前的记录 + 精简 DOM 规则）
 * 3. 启动 ExecutionEngine (micro-task 模式)
 * 4. 微任务完成后，生成执行记录，追加到记录链
 * 5. 结果返回给 Main Agent
 */
async function handleDispatchMicroTask(
  params: { task: string },
  engine: ExecutionEngine,
  monitor: TaskMonitor,
  currentSnapshot: string,
): Promise<ToolResult> {
  // 1. 获取之前的执行记录作为上下文
  const previousContext = monitor.recordChain.buildPreviousContext();

  // 2. 构建微任务 prompt
  const prompt = buildMicroTaskPrompt({
    task: params.task,
    previouslyCompleted: previousContext,
  });

  // 3. 执行微任务
  const result = await engine.run({
    role: "micro-task",
    prompt,
    initialSnapshot: currentSnapshot,
    maxRounds: 15,
  });

  // 4. 生成执行记录并追加到链
  const record: MicroTaskExecutionRecord = {
    id: generateId(),
    task: params.task,
    success: result.success,
    // completedSubGoals 由微任务 AI 在 REMAINING: DONE 时一并输出，
    // 描述完成了哪些子目标（自然语言，不含选择器等技术细节）。
    // 部分失败时只含已确认完成的目标，重新执行时 AI 据此识别缺口。
    completedSubGoals: result.completedSubGoals ?? [],
    actions: result.toolCallSummaries,
    summary: result.reply,
  };
  monitor.recordChain.append(record);

  // 5. 返回给 Main Agent
  return {
    success: result.success,
    summary: result.reply,
    executionRecord: record,
    finalSnapshot: result.finalSnapshot,
    failureReason: result.failureReason,
  };
}
```

### 8.3 系统断言时消费完整记录链

```typescript
/**
 * Main Agent 调用 assert({}) 触发系统断言时：
 * 从执行记录链中提取完整证据，传给 Assertion Agent
 */
async function handleSystemAssert(
  monitor: TaskMonitor,
  initialSnapshot: string,
  currentSnapshot: string,
): Promise<AssertionResult> {
  // buildEvidenceSummary 将每条记录的 completedSubGoals 展开为断言证据：
  //   ✅ 填写基本信息：填写了姓名张三、选择了性别男、填写了年龄30
  //   ✅ 填写联系方式：填写了手机13800138000、填写了邮箱xxx@xx.com
  //   ✗ 填写地址（部分）：填写了省市，街道地址未完成
  // 断言 AI 凭此判断整体任务是否满足用户目标，不需要推断操作了哪些元素。
  const evidence = monitor.recordChain.buildEvidenceSummary();

  return evaluateAssertions({
    level: "system",
    initialSnapshot,
    currentSnapshot,
    executionEvidence: evidence,  // 完整执行记录链（含各条 completedSubGoals）
    assertions: taskAssertions,
  });
}
```

---

## 9. 快照传递策略

```
                  初始快照 (任务开始时)
                    │
                    ▼
            ┌───────────────┐
            │  Main Agent   │ ← 持有全局初始快照（用于系统断言）
            │               │ ← 自己操作时正常刷新快照
            │               │ ← 微任务完成后接收 finalSnapshot
            └───────┬───────┘
                    │ 当前快照 + 执行记录链 传入微任务
                    ▼
            ┌───────────────┐
            │  Micro-task   │ ← 接收执行前快照
            │               │ ← 接收之前微任务的执行记录（上下文）
            │               │ ← 内部循环中自主刷新快照
            │               │ ← 完成时返回 finalSnapshot + 执行记录
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  Assertion    │ ← 微任务断言: 微任务前后快照 + 执行记录
            │               │ ← 系统断言: 全局初始/最终快照 + 完整记录链
            └───────────────┘
```

---

## 10. 保护机制分层

### 10.1 执行层保护（Main Agent 和 Micro-task Agent 共享）

由统一的 ExecutionEngine 提供，两种模式完全相同：

```
┌─────────────────────────────────────────────┐
│  执行层保护（继承现有 14 层保护机制）          │
│                                             │
│  - 元素恢复 (ELEMENT_NOT_FOUND → retry)     │
│  - 无效点击拦截 (snapshot unchanged)         │
│  - 点击循环检测 (≤2 unique in 4+ rounds)    │
│  - 快照指纹比对 (fingerprint unchanged)      │
│  - 稳定性屏障 (loading hidden + DOM quiet)   │
│  - 空闲检测 (3+ read-only rounds)           │
│  - 重复批次检测 (3+ identical tool calls)    │
│  - 最大轮次限制 (main=40, micro-task=15)     │
│  - 断言死循环 (2+ assert-only fail)          │
│  - 导航后快照刷新                            │
│  - 快照 diff 注入                            │
│  - REMAINING 协议监控                        │
│  - Original Goal Anchor                     │
│  - 无效选择器缓存                            │
└─────────────────────────────────────────────┘
```

### 10.2 编排层保护（Main Agent 独有）

```
┌─────────────────────────────────────────────┐
│  编排层保护（微任务调度相关）                   │
│                                             │
│  - 微任务超时: 单个微任务轮次超限 → 终止       │
│  - 微任务失败重试: 最多 2 次                  │
│  - 再规划触发: 重试耗尽 → Main Agent 重新评估  │
│  - 系统断言死循环: 2+ 次全局断言失败 → 停止     │
│  - 总微任务数限制: 防止无限分解               │
│  - REMAINING 停滞检测                        │
└─────────────────────────────────────────────┘
```

---

## 11. 类型定义

```typescript
// ─── 执行引擎配置 ───

type AgentRole = "main" | "micro-task";

interface AgentConfig {
  role: AgentRole;
  prompt: string;
  maxRounds: number;
  enabledTools: string[];
  canDispatch: boolean;
}

// ─── 执行记录 ───

interface MicroTaskExecutionRecord {
  id: string;
  task: string;
  success: boolean;
  /**
   * 已完成的子目标（任务语义层面，非元素操作层面）。
   * 用自然语言描述"完成了哪些目标"，不记录操作了哪个选择器。
   * 示例：["填写了姓名和年龄", "选择了性别为男"]
   *
   * 两个用途：
   * 1. 作为 Previously completed 上下文传给下一个微任务
   *    （告知已完成哪些目标，避免重复或遗漏）
   * 2. 作为执行证据传给断言 AI
   *    （让 AI 判断哪些目标已达成、哪些尚缺失，不需要推断操作细节）
   *
   * 完整成功时：等于任务全集；
   * 部分失败时：仅含已确认完成的部分，重新执行时 AI 据此补全缺口。
   */
  completedSubGoals: string[];
  actions: string[];
  summary: string;
  assertionResult?: AssertionResult;
}

interface ExecutionRecordChain {
  records: MicroTaskExecutionRecord[];
  append(record: MicroTaskExecutionRecord): void;
  buildPreviousContext(): string;
  buildEvidenceSummary(): string;
}

// ─── 微任务 ───

interface MicroTaskDescriptor {
  id: string;
  task: string;
  assertions?: TaskAssertion[];
  maxRounds?: number;
}

interface MicroTaskResult {
  task: MicroTaskDescriptor;
  success: boolean;
  executionRecord: MicroTaskExecutionRecord;
  metrics: AgentLoopMetrics;
  finalSnapshot: string;
  failureReason?: string;
}

// ─── dispatch_micro_task 工具参数 ───

interface DispatchMicroTaskParams {
  task: string;
  assertions?: TaskAssertion[];
}

// ─── 执行结果 ───

interface AgentResult {
  reply: string;
  stopReason: StopReason;
  metrics: AgentLoopMetrics;
  executionRecordChain: ExecutionRecordChain;
  microTaskResults?: MicroTaskResult[];
  systemAssertionResult?: AssertionResult;
}

// ─── 再规划 ───

interface ReplanTrigger {
  microTaskExhausted: boolean;
  unexpectedPageState: boolean;
  preconditionBroken: boolean;
}
```

---

## 12. Prompt 职责对比

| 维度 | 当前（单一 Prompt） | 新设计 |
|------|---------------------|--------|
| **执行聚焦** | 一个 prompt 管所有字段 | 微任务 prompt 只关注自己负责的区域 |
| **上下文** | 随轮次无限膨胀 | 微任务独立上下文 + 执行记录链传递 |
| **进度感知** | REMAINING 一长串 | 执行记录链 → "Previously completed" |
| **断言证据** | 只有前后快照 | 前后快照 + 完整执行记录链 |
| **简单任务** | 统一 prompt | Main Agent 直接执行（零开销） |
| **大表单** | 一个 Agent 硬扛 | 拆成区域，每个微任务只管几个字段 |
| **任务分解** | helpers.ts 硬编码分隔符 | Main Agent AI 智能分解 |
| **恢复** | 14 层保护在一个 loop | 执行层共享 + 编排层(再规划)新增 |

---

## 13. 目录结构规划

```
src-v2/
├── core/
│   ├── engine/                    # 统一执行引擎
│   │   ├── index.ts              # ExecutionEngine — 共享的 Agent Loop
│   │   ├── config.ts             # AgentConfig — main / micro-task 配置
│   │   ├── types.ts              # 引擎层类型定义
│   │   ├── messages.ts           # 消息构建（按 role 区分）
│   │   ├── helpers.ts            # REMAINING 协议、快照指纹等
│   │   ├── constants.ts          # 常量
│   │   ├── recovery/             # 保护机制（复用现有）
│   │   │   └── index.ts
│   │   └── snapshot/             # 快照生命周期（复用现有）
│   │       ├── lifecycle.ts
│   │       └── engine.ts
│   │
│   ├── main-agent/                # Main Agent 专属
│   │   ├── prompt.ts             # Main Prompt (DOM 规则 + 调度规则)
│   │   └── dispatch.ts           # dispatch_micro_task 工具实现
│   │
│   ├── micro-task/                # Micro-task Agent 专属
│   │   ├── prompt.ts             # Micro-task Prompt (精简 + 聚焦)
│   │   ├── record.ts             # 执行记录生成
│   │   └── task-monitor.ts       # 微任务监听器 + 执行记录链
│   │
│   ├── assertion/                 # 断言 Agent
│   │   ├── index.ts              # 断言评估引擎
│   │   ├── prompt.ts             # 断言专用 Prompt
│   │   ├── types.ts              # 断言类型定义
│   │   └── levels.ts             # 分级断言策略 (Level 0/1/2)
│   │
│   ├── shared/                    # 跨 Agent 共享
│   │   ├── types.ts              # AIMessage, StopReason, etc.
│   │   ├── ai-client/            # AI 客户端（完全复用现有）
│   │   └── tool-registry.ts      # 工具注册表（复用现有）
│   │
│   └── index.ts                   # 入口
│
└── web/                            # 浏览器层（基本不变）
    ├── index.ts                   # WebAgent
    ├── tools/                     # Web 工具（不变）
    └── ...
```

---

## 14. 与现有代码的关系

### 14.1 可直接复用

| 模块 | 说明 |
|------|------|
| `ai-client/` | AI 提供商客户端，完全通用 |
| `tool-registry.ts` | 工具注册/分派，通用 |
| `tool-params.ts` | 参数解析，通用 |
| `assertion/` | 断言核心逻辑可复用，扩展记录链输入 |
| `snapshot/` | 快照生命周期，通用 |
| `recovery/` | 保护机制，通用 |
| `web/tools/` | 全部 Web 工具，不变 |
| `web/ref-store.ts` | DOM 引用管理，不变 |

### 14.2 需要重构

| 模块 | 变更 |
|------|------|
| `agent-loop/index.ts` | 重构为 `engine/index.ts`，支持 role 配置 |
| `system-prompt.ts` | 拆为 `main-agent/prompt.ts` + `micro-task/prompt.ts` |
| `agent-loop/helpers.ts` | 迁移到 `engine/helpers.ts` |
| `agent-loop/messages.ts` | 迁移到 `engine/messages.ts`，按 role 区分 |
| `web/index.ts` | WebAgent 入口适配新引擎 |

### 14.3 新增模块

| 模块 | 说明 |
|------|------|
| `engine/config.ts` | Agent 运行配置 |
| `main-agent/dispatch.ts` | dispatch_micro_task 工具 |
| `micro-task/record.ts` | 执行记录生成 |
| `micro-task/task-monitor.ts` | 微任务监听 + 执行记录链 |
| `assertion/levels.ts` | 分级断言策略 |

---

## 15. 渐进式迁移策略

### Phase 1 — 执行引擎抽取
- 从现有 `agent-loop/index.ts` 抽取为 `engine/index.ts`
- 支持通过 `AgentConfig` 配置不同运行模式
- 此阶段只有 main 模式，行为与现有系统一致
- **验证：现有功能不退化**

### Phase 2 — 执行记录链
- 实现 `ExecutionRecordChain`
- 实现 `MicroTaskExecutionRecord` 生成逻辑
- **验证：执行记录能正确沉淀和传递**

### Phase 3 — 微任务模式
- 实现 `micro-task/prompt.ts`（精简 Prompt + Previously completed 注入）
- 实现 `main-agent/dispatch.ts`（dispatch_micro_task 工具）
- 实现 `micro-task/task-monitor.ts`（监听 + 记录链管理）
- Main Agent Prompt 增加调度规则
- **验证：大表单场景，微任务聚焦执行成功率 > 单 Agent**

### Phase 4 — 断言增强
- 系统断言消费完整执行记录链
- 实现分级断言 (Level 0/1/2)
- **验证：断言准确率提升**

### Phase 5 — 再规划 + 集成测试
- 微任务失败 → Main Agent 重新评估
- 与现有 `src/` A/B 对比测试
- 对比：成功率、token 消耗、执行轮次
