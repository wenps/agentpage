import { describe, expect, it } from "vitest";
import { buildCompactMessages, isExplicitAgentUiRequest } from "./messages.js";

describe("behavior boundary - agent ui interaction", () => {
  it("默认不误触：普通任务应包含禁止操作 Agent UI 的约束", () => {
    const messages = buildCompactMessages(
      "帮我填写表单并提交",
      [],
      "[body] #abc",
      "https://example.com",
    );

    const payload = String(messages[0].content);
    expect(payload).toContain("Do NOT interact with any AI chat UI elements");
    expect(payload).not.toContain("User explicitly asked to operate AutoPilot UI");
  });

  it("明确指令可执行：当用户点名输入框和发送按钮时放行", () => {
    expect(isExplicitAgentUiRequest("帮我在指令输入框输入11然后发送")).toBe(true);
    expect(isExplicitAgentUiRequest("帮我在指令输入框输入 11 ，然后发送")).toBe(true);
    expect(isExplicitAgentUiRequest("在消息输入框填入11并点击发送按钮")).toBe(true);

    const messages = buildCompactMessages(
      "帮我在指令输入框输入11然后发送",
      [],
      "[body] #abc",
      "https://example.com",
    );

    const payload = String(messages[0].content);
    expect(payload).toContain("User explicitly asked to operate AutoPilot UI");
    expect(payload).not.toContain("Do NOT interact with any AI chat UI elements");
  });
});
