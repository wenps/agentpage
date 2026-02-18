/**
 * Browser Tool — 将 Playwright 浏览器控制能力暴露给 AI Agent。
 *
 * 这是 AI 的"眼睛"和"鼠标"：AI 可以通过这个工具像人类一样浏览网页、
 * 填写表单、点击按钮、截图、执行 JavaScript 等。
 *
 * 支持 17 种动作：
 *   导航类：navigate, go_back, go_forward, reload
 *   交互类：click, fill, type, select_option, press_key
 *   信息类：screenshot, snapshot, evaluate, get_url, get_title, get_cookies
 *   等待类：wait_for
 *   生命周期：close
 *
 * 设计要点：
 * - 单例复用：通过 getOrCreateController() 全局共享一个浏览器实例
 * - 自动启动：执行非 close 动作时，若浏览器未运行会自动 launch()
 * - 错误隔离：所有动作包在 try/catch 中，出错返回错误文本而非抛异常
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";
import { BrowserController } from "../browser/controller.js";
import { loadConfig } from "../config.js";

/**
 * 获取已有的浏览器控制器实例，或根据配置创建一个新的。
 * 单例模式：整个进程只维护一个浏览器实例，避免重复打开。
 */
function getOrCreateController(): BrowserController {
  // 先检查是否有正在运行的浏览器实例
  const existing = BrowserController.getRunning();
  if (existing) return existing;

  // 没有 → 从配置读取 headless 和 executablePath，创建新实例
  const config = loadConfig();
  return new BrowserController({
    headless: config.browser?.headless ?? false,      // 默认有头模式（可以看到浏览器窗口）
    executablePath: config.browser?.executablePath,   // 自定义 Chromium 路径（可选）
  });
}

export function createBrowserTool(): ToolDefinition {
  return {
    name: "browser",
    description: [
      "Control a browser to navigate, interact with elements, take screenshots, and read page content.",
      "Actions: navigate, click, fill, type, screenshot, snapshot, evaluate, get_url, get_title,",
      "wait_for, select_option, press_key, go_back, go_forward, reload, get_cookies, close.",
    ].join(" "),

    // 参数 Schema — 告诉 AI 这个工具接受哪些参数
    // action 是必填的，其余参数根据 action 类型选择性传入
    schema: Type.Object({
      action: Type.String({ description: "The browser action to perform" }),
      url: Type.Optional(Type.String({ description: "URL for navigate action" })),
      selector: Type.Optional(Type.String({ description: "CSS selector for click/fill/type/wait_for/select_option" })),
      value: Type.Optional(Type.String({ description: "Value for fill/type/select_option actions" })),
      key: Type.Optional(Type.String({ description: "Key for press_key action" })),
      expression: Type.Optional(Type.String({ description: "JavaScript for evaluate action" })),
      outputPath: Type.Optional(Type.String({ description: "File path for screenshot output" })),
    }),

    execute: async (params): Promise<ToolCallResult> => {
      const action = params.action as string;
      const controller = getOrCreateController();

      try {
        // 自动启动：如果浏览器没在运行且动作不是 close，就先 launch
        if (!controller.isRunning() && action !== "close") {
          await controller.launch();
        }

        switch (action) {
          // ─── 导航类 ───

          case "navigate": {
            // 打开指定 URL，返回页面标题作为确认
            const url = params.url as string;
            if (!url) return { content: "Missing 'url' parameter for navigate action" };
            await controller.navigate(url);
            const title = await controller.getTitle();
            return { content: `Navigated to ${url} — "${title}"` };
          }

          case "go_back":
            // 浏览器后退（等同于用户点击后退按钮）
            await controller.goBack();
            return { content: "Went back" };

          case "go_forward":
            // 浏览器前进
            await controller.goForward();
            return { content: "Went forward" };

          case "reload":
            // 刷新当前页面
            await controller.reload();
            return { content: "Reloaded page" };

          // ─── 交互类 ───

          case "click": {
            // 点击匹配 CSS 选择器的元素
            const selector = params.selector as string;
            if (!selector) return { content: "Missing 'selector' parameter" };
            await controller.click(selector);
            return { content: `Clicked "${selector}"` };
          }

          case "fill": {
            // 填写表单：先清空输入框内容，再填入新值
            // 适用于 <input>、<textarea> 等表单元素
            const selector = params.selector as string;
            const value = params.value as string;
            if (!selector || value === undefined) return { content: "Missing 'selector' or 'value'" };
            await controller.fill(selector, value);
            return { content: `Filled "${selector}" with "${value}"` };
          }

          case "type": {
            // 逐字符模拟键盘输入（与 fill 不同，type 会触发每个按键事件）
            // 适用于需要实时响应键入的场景（如搜索框自动补全）
            const selector = params.selector as string;
            const value = params.value as string;
            if (!selector || value === undefined) return { content: "Missing 'selector' or 'value'" };
            await controller.type(selector, value);
            return { content: `Typed "${value}" into "${selector}"` };
          }

          case "select_option": {
            // 选择 <select> 下拉菜单中的某个选项
            const selector = params.selector as string;
            const value = params.value as string;
            if (!selector || !value) return { content: "Missing 'selector' or 'value'" };
            await controller.selectOption(selector, value);
            return { content: `Selected "${value}" in "${selector}"` };
          }

          case "press_key": {
            // 模拟单次键盘按键（如 Enter、Tab、Escape、ArrowDown 等）
            const key = params.key as string;
            if (!key) return { content: "Missing 'key' parameter" };
            await controller.pressKey(key);
            return { content: `Pressed key "${key}"` };
          }

          // ─── 信息获取类 ───

          case "screenshot": {
            // 对当前页面截图并保存为图片文件
            const outputPath = (params.outputPath as string) ?? "screenshot.png";
            const saved = await controller.screenshot(outputPath);
            return { content: `Screenshot saved to ${saved}` };
          }

          case "snapshot": {
            // 获取页面的无障碍性树（accessibility tree）
            // 这是 AI "看懂"页面结构的主要方式 — 返回类似 DOM 的文本描述
            const tree = await controller.snapshot("text");
            return { content: tree };
          }

          case "evaluate": {
            // 在页面上下文中执行任意 JavaScript 表达式并返回结果
            const expression = params.expression as string;
            if (!expression) return { content: "Missing 'expression' parameter" };
            const result = await controller.evaluate(expression);
            return { content: JSON.stringify(result, null, 2) };
          }

          case "get_url":
            // 获取当前页面的 URL
            return { content: controller.getUrl() };

          case "get_title": {
            // 获取当前页面的 <title> 标题
            const title = await controller.getTitle();
            return { content: title };
          }

          case "get_cookies": {
            // 获取当前页面的所有 Cookie（用于调试登录状态等）
            const cookies = await controller.getCookies();
            return { content: JSON.stringify(cookies, null, 2) };
          }

          // ─── 等待类 ───

          case "wait_for": {
            // 等待某个元素出现在页面上（用于页面加载、动态内容渲染后再操作）
            const selector = params.selector as string;
            if (!selector) return { content: "Missing 'selector' parameter" };
            await controller.waitForSelector(selector);
            return { content: `Element "${selector}" found` };
          }

          // ─── 生命周期 ───

          case "close":
            // 关闭浏览器实例，释放资源
            await controller.close();
            return { content: "Browser closed" };

          default:
            return { content: `Unknown browser action: ${action}` };
        }
      } catch (err) {
        // 统一错误处理：不抛异常，返回错误文本让 AI 知道发生了什么
        return {
          content: `Browser action "${action}" failed: ${err instanceof Error ? err.message : String(err)}`,
          details: { error: true, action },
        };
      }
    },
  };
}
