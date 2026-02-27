import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { executeAgentLoop } from "./index.js";
import { ToolRegistry, type ToolCallResult } from "../tool-registry.js";
import type { AIClient, AIChatResponse, AIMessage, AIToolCall } from "../types.js";

type ScriptedStep = {
  text?: string;
  toolCalls?: AIToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  assert?: (params: { systemPrompt: string; messages: AIMessage[] }) => void;
};

class ScriptedClient implements AIClient {
  private index = 0;

  constructor(private readonly steps: ScriptedStep[]) {}

  async chat(params: {
    systemPrompt: string;
    messages: AIMessage[];
  }): Promise<AIChatResponse> {
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    this.index += 1;
    step.assert?.(params);
    return {
      text: step.text,
      toolCalls: step.toolCalls,
      usage: step.usage,
    };
  }
}

function createPageInfoTool(options: {
  snapshots: string[];
  getUrl: () => string;
}) {
  let snapshotIndex = 0;

  return {
    name: "page_info",
    description: "page info",
    schema: Type.Object({ action: Type.String() }),
    execute: async (params: Record<string, unknown>): Promise<ToolCallResult> => {
      const action = params.action;
      if (action === "snapshot") {
        const current = options.snapshots[Math.min(snapshotIndex, options.snapshots.length - 1)] ?? "[body] #empty";
        snapshotIndex += 1;
        return { content: current };
      }
      if (action === "get_url") {
        return { content: options.getUrl() };
      }
      if (action === "query_all") {
        return { content: "query result" };
      }
      return { content: "ok" };
    },
  };
}

function createBaseRegistry(options?: {
  snapshots?: string[];
  getUrl?: () => string;
  domExecute?: (params: Record<string, unknown>) => Promise<ToolCallResult>;
  navigateExecute?: (params: Record<string, unknown>) => Promise<ToolCallResult>;
}): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(createPageInfoTool({
    snapshots: options?.snapshots ?? ["[body] #snap0", "[body] #snap1", "[body] #snap2"],
    getUrl: options?.getUrl ?? (() => "https://example.com"),
  }));

  registry.register({
    name: "dom",
    description: "dom tool",
    schema: Type.Object({ action: Type.String() }),
    execute: options?.domExecute ?? (async () => ({ content: "dom ok" })),
  });

  registry.register({
    name: "navigate",
    description: "navigate tool",
    schema: Type.Object({ action: Type.String() }),
    execute: options?.navigateExecute ?? (async () => ({ content: "navigate ok" })),
  });

  return registry;
}

describe("executeAgentLoop golden paths", () => {
  it("正常完成：可执行工具后返回最终总结", async () => {
    const registry = createBaseRegistry();
    const onMetrics = vi.fn();

    const client = new ScriptedClient([
      {
        toolCalls: [{ id: "1", name: "dom", input: { action: "fill", selector: "#a", value: "11" } }],
        usage: { inputTokens: 12, outputTokens: 8 },
      },
      {
        text: "已完成",
        usage: { inputTokens: 10, outputTokens: 6 },
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "输入 11 并提交",
      callbacks: { onMetrics },
    });

    expect(result.reply).toBe("已完成");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.metrics.roundCount).toBe(2);
    expect(result.metrics.totalToolCalls).toBe(1);
    expect(result.metrics.successfulToolCalls).toBe(1);
    expect(result.metrics.inputTokens).toBe(22);
    expect(result.metrics.outputTokens).toBe(14);
    expect(onMetrics).toHaveBeenCalledTimes(1);
  });

  it("弹窗跨轮：第2轮消息包含 Done steps 再继续执行", async () => {
    const registry = createBaseRegistry();

    const client = new ScriptedClient([
      {
        toolCalls: [{ id: "1", name: "dom", input: { action: "click", selector: "#openModal" } }],
      },
      {
        assert: ({ messages }) => {
          const assistantDone = messages.find(m => m.role === "assistant")?.content;
          expect(typeof assistantDone).toBe("string");
          expect(String(assistantDone)).toContain("Done steps");
          expect(String(assistantDone)).toContain("openModal");
        },
        toolCalls: [{ id: "2", name: "dom", input: { action: "fill", selector: "#taskTitle", value: "任务11" } }],
      },
      {
        text: "弹窗任务已提交",
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "打开弹窗并填写标题后提交",
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(result.reply).toBe("弹窗任务已提交");
  });

  it("元素找不到恢复：触发 recovery 并计入指标", async () => {
    const onBeforeRecoverySnapshot = vi.fn();
    const registry = createBaseRegistry({
      domExecute: async () => ({
        content: "未找到元素",
        details: { error: true, code: "ELEMENT_NOT_FOUND" },
      }),
    });

    const client = new ScriptedClient([
      {
        toolCalls: [{ id: "1", name: "dom", input: { action: "click", selector: "#missing", waitMs: 0 } }],
      },
      {
        text: "结束",
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "点击不存在元素",
      callbacks: { onBeforeRecoverySnapshot },
    });

    expect(result.toolCalls[0].result.details).toMatchObject({ code: "ELEMENT_NOT_FOUND_RECOVERY" });
    expect(result.metrics.recoveryCount).toBe(1);
    expect(onBeforeRecoverySnapshot).toHaveBeenCalled();
  });

  it("空转终止：连续只读轮次后自动退出", async () => {
    const registry = createBaseRegistry();

    const client = new ScriptedClient([
      {
        toolCalls: [{ id: "1", name: "page_info", input: { action: "query_all", selector: "button" } }],
      },
      {
        toolCalls: [{ id: "2", name: "page_info", input: { action: "query_all", selector: "a" } }],
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "请执行任务",
    });

    expect(result.reply).toBe("任务已完成。");
    expect(result.metrics.roundCount).toBe(2);
    expect(result.metrics.redundantInterceptCount).toBe(2);
  });

  it("导航后重定位：URL 变化触发上下文刷新", async () => {
    let currentUrl = "https://example.com/a";
    const onBeforeRecoverySnapshot = vi.fn();

    const registry = createBaseRegistry({
      getUrl: () => currentUrl,
      navigateExecute: async (params) => {
        if (params.action === "goto") {
          currentUrl = "https://example.com/b";
        }
        return { content: "navigate ok" };
      },
    });

    const client = new ScriptedClient([
      {
        toolCalls: [{ id: "1", name: "navigate", input: { action: "goto", url: "https://example.com/b" } }],
      },
      {
        text: "导航完成",
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "跳转到 b 页面",
      callbacks: { onBeforeRecoverySnapshot },
    });

    expect(result.reply).toBe("导航完成");
    expect(onBeforeRecoverySnapshot).toHaveBeenCalledWith("https://example.com/b");
  });

  it("指标聚合：输出成功率、快照大小、token 汇总", async () => {
    const registry = createBaseRegistry({
      snapshots: ["[body] #a", "[body] #abcdef", "[body] #xyz"],
      domExecute: async () => ({ content: "dom failed", details: { error: true, code: "DOM_FAIL" } }),
    });

    const client = new ScriptedClient([
      {
        usage: { inputTokens: 100, outputTokens: 30 },
        toolCalls: [{ id: "1", name: "dom", input: { action: "click", selector: "#btn" } }],
      },
      {
        usage: { inputTokens: 90, outputTokens: 20 },
        text: "结束",
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "测试指标",
    });

    expect(result.metrics.inputTokens).toBe(190);
    expect(result.metrics.outputTokens).toBe(50);
    expect(result.metrics.totalToolCalls).toBe(1);
    expect(result.metrics.failedToolCalls).toBe(1);
    expect(result.metrics.toolSuccessRate).toBe(0);
    expect(result.metrics.snapshotReadCount).toBeGreaterThan(0);
    expect(result.metrics.maxSnapshotSize).toBeGreaterThan(0);
  });

  it("重复相同任务批次且上轮无错：自动终止避免自转", async () => {
    const registry = createBaseRegistry({
      domExecute: async () => ({ content: "dom ok" }),
    });

    const client = new ScriptedClient([
      {
        text: "REMAINING: 输入11并发送",
        toolCalls: [{ id: "1", name: "dom", input: { action: "fill", selector: "#input", text: "11" } }],
      },
      {
        text: "REMAINING: DONE",
        toolCalls: [{ id: "2", name: "dom", input: { action: "fill", selector: "#input", text: "11" } }],
      },
      {
        text: "不应执行到这里",
      },
    ]);

    const result = await executeAgentLoop({
      client,
      registry,
      systemPrompt: "test prompt",
      message: "帮我在指令输入框输入11然后发送",
      maxRounds: 5,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.reply).toContain("REMAINING: DONE");
    expect(result.metrics.roundCount).toBe(2);
  });
});
