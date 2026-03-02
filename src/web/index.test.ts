import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { WebAgent } from "./index.js";

describe("WebAgent system prompt registry", () => {
  it("兼容旧用法：setSystemPrompt(prompt) 写入默认 key", () => {
    const agent = new WebAgent({});

    agent.setSystemPrompt("default prompt text");

    expect(agent.getSystemPrompts()).toEqual({
      default: "default prompt text",
    });
  });

  it("支持 setSystemPrompt(key, prompt) 与 setSystemPrompts 批量注册", () => {
    const agent = new WebAgent({});

    agent.setSystemPrompt("safety", "safety prompt");
    agent.setSystemPrompts({
      style: "style prompt",
      task: "task prompt",
    });

    expect(agent.getSystemPrompts()).toEqual({
      safety: "safety prompt",
      style: "style prompt",
      task: "task prompt",
    });
  });

  it("支持 removeSystemPrompt / keepOnlySystemPrompt / clearSystemPrompts", () => {
    const agent = new WebAgent({});
    agent.setSystemPrompts({
      a: "prompt-a",
      b: "prompt-b",
      c: "prompt-c",
    });

    expect(agent.removeSystemPrompt("x")).toBe(false);
    expect(agent.removeSystemPrompt("b")).toBe(true);
    expect(agent.getSystemPrompts()).toEqual({
      a: "prompt-a",
      c: "prompt-c",
    });

    expect(agent.keepOnlySystemPrompt("not-exist")).toBe(false);
    expect(agent.keepOnlySystemPrompt("a")).toBe(true);
    expect(agent.getSystemPrompts()).toEqual({
      a: "prompt-a",
    });

    agent.clearSystemPrompts();
    expect(agent.getSystemPrompts()).toEqual({});
  });

  it("构造函数支持 string 与 record 两种 systemPrompt 初始化", () => {
    const byString = new WebAgent({
      systemPrompt: "hello from option",
    });
    expect(byString.getSystemPrompts()).toEqual({
      default: "hello from option",
    });

    const byRecord = new WebAgent({
      systemPrompt: {
        k1: "v1",
        k2: "v2",
      },
    });
    expect(byRecord.getSystemPrompts()).toEqual({
      k1: "v1",
      k2: "v2",
    });
  });

  it("getSystemPrompts 返回浅拷贝，外部修改不影响内部状态", () => {
    const agent = new WebAgent({});
    agent.setSystemPrompt("alpha", "value-alpha");

    const snapshot = agent.getSystemPrompts();
    snapshot.alpha = "changed-outside";

    expect(agent.getSystemPrompts()).toEqual({
      alpha: "value-alpha",
    });
  });
});

describe("WebAgent tools management", () => {
  it("支持注册、读取、删除自定义工具", () => {
    const agent = new WebAgent({});

    agent.registerTool({
      name: "custom_echo",
      description: "echo tool",
      schema: Type.Object({ text: Type.String() }),
      execute: async (params) => ({ content: String(params.text ?? "") }),
    });

    expect(agent.hasTool("custom_echo")).toBe(true);
    expect(agent.getToolNames()).toContain("custom_echo");
    expect(agent.getTools().some(t => t.name === "custom_echo")).toBe(true);

    expect(agent.removeTool("custom_echo")).toBe(true);
    expect(agent.hasTool("custom_echo")).toBe(false);
  });

  it("默认工具注册后不可删除", () => {
    const agent = new WebAgent({});
    agent.registerTools();

    expect(agent.hasTool("dom")).toBe(true);
    expect(agent.removeTool("dom")).toBe(false);
    expect(agent.removeTool("navigate")).toBe(false);
    expect(agent.removeTool("page_info")).toBe(false);
    expect(agent.removeTool("wait")).toBe(false);
    expect(agent.removeTool("evaluate")).toBe(false);
    expect(agent.hasTool("dom")).toBe(true);
  });

  it("clearCustomTools 仅删除自定义工具，不影响默认工具", () => {
    const agent = new WebAgent({});
    agent.registerTools();
    agent.registerTool({
      name: "custom_one",
      description: "custom one",
      schema: Type.Object({}),
      execute: async () => ({ content: "ok" }),
    });
    agent.registerTool({
      name: "custom_two",
      description: "custom two",
      schema: Type.Object({}),
      execute: async () => ({ content: "ok" }),
    });

    const removed = agent.clearCustomTools().sort();
    expect(removed).toEqual(["custom_one", "custom_two"]);

    expect(agent.hasTool("custom_one")).toBe(false);
    expect(agent.hasTool("custom_two")).toBe(false);
    expect(agent.hasTool("dom")).toBe(true);
    expect(agent.hasTool("navigate")).toBe(true);
    expect(agent.hasTool("page_info")).toBe(true);
    expect(agent.hasTool("wait")).toBe(true);
    expect(agent.hasTool("evaluate")).toBe(true);
  });
});
