/**
 * Page Info Tool — 基于 Web API 的页面信息获取工具。
 *
 * 替代 Playwright 的 getTitle/getUrl/snapshot 等。
 * 运行环境：浏览器 Content Script。
 *
 * 支持 6 种动作：
 *   get_url       — 获取当前页面 URL
 *   get_title     — 获取页面标题
 *   get_selection — 获取用户选中的文本
 *   get_viewport  — 获取视口尺寸和滚动位置
 *   snapshot      — 获取页面 DOM 结构快照（AI 可读的文本描述）
 *   query_all     — 查询所有匹配选择器的元素，返回摘要信息
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";

/**
 * 生成页面 DOM 快照 — 将 DOM 树转为 AI 可理解的文本描述。
 *
 * 类似 Playwright 的 ariaSnapshot()，但基于 Web API 实现。
 * 只遍历可见元素，跳过 script/style/svg 等无意义节点。
 *
 * 输出格式示例：
 *   [header]
 *     [nav]
 *       [a] "首页" href="/"
 *       [a] "关于" href="/about"
 *   [main]
 *     [h1] "欢迎来到示例网站"
 *     [input] type="text" placeholder="搜索..."
 *     [button] "搜索"
 */
function generateSnapshot(root: Element = document.body, maxDepth = 6): string {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "SVG", "NOSCRIPT", "LINK", "META", "BR", "HR",
  ]);

  const INTERACTIVE_ATTRS = ["href", "type", "placeholder", "value", "name", "role", "aria-label"];

  function walk(el: Element, depth: number): string {
    if (depth > maxDepth) return "";
    if (SKIP_TAGS.has(el.tagName)) return "";

    // 跳过不可见元素
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return "";

    const indent = "  ".repeat(depth);
    const tag = el.tagName.toLowerCase();

    // 收集有意义的属性
    const attrs: string[] = [];
    for (const attr of INTERACTIVE_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) attrs.push(`${attr}="${val}"`);
    }

    // 获取直接文本（不含子元素文本）
    let directText = "";
    for (let i = 0; i < el.childNodes.length; i++) {
      const node = el.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent?.trim();
        if (t) directText += t + " ";
      }
    }
    directText = directText.trim();

    // 构建当前元素描述
    let line = `${indent}[${tag}]`;
    if (directText) line += ` "${directText.slice(0, 80)}"`;
    if (attrs.length) line += ` ${attrs.join(" ")}`;

    const lines: string[] = [line];

    // 递归子元素
    for (let i = 0; i < el.children.length; i++) {
      const childResult = walk(el.children[i], depth + 1);
      if (childResult) lines.push(childResult);
    }

    return lines.join("\n");
  }

  return walk(root, 0) || "(空页面)";
}

/**
 * 查询所有匹配元素并返回摘要信息（标签、文本、关键属性）。
 */
function queryAllElements(selector: string, limit = 20): string {
  try {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return `未找到匹配 "${selector}" 的元素`;

    const results: string[] = [`找到 ${elements.length} 个元素：`];
    const count = Math.min(elements.length, limit);

    for (let i = 0; i < count; i++) {
      const el = elements[i];
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().slice(0, 60) ?? "";
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string"
        ? `.${el.className.split(" ").filter(Boolean).join(".")}`
        : "";
      results.push(`  ${i + 1}. <${tag}${id}${cls}> "${text}"`);
    }

    if (elements.length > limit) {
      results.push(`  ...还有 ${elements.length - limit} 个元素`);
    }

    return results.join("\n");
  } catch (e) {
    return `选择器语法错误: ${selector}`;
  }
}

export function createPageInfoTool(): ToolDefinition {
  return {
    name: "page_info",
    description: [
      "Get information about the current page.",
      "Actions: get_url, get_title, get_selection (selected text),",
      "get_viewport (size & scroll), snapshot (DOM structure), query_all (find all matching elements).",
    ].join(" "),

    schema: Type.Object({
      action: Type.String({
        description:
          "Info action: get_url | get_title | get_selection | get_viewport | snapshot | query_all",
      }),
      selector: Type.Optional(
        Type.String({ description: "CSS selector for query_all action" }),
      ),
      maxDepth: Type.Optional(
        Type.Number({ description: "Max depth for snapshot (default: 6)" }),
      ),
    }),

    execute: async (params): Promise<ToolCallResult> => {
      const action = params.action as string;

      try {
        switch (action) {
          case "get_url":
            return { content: window.location.href };

          case "get_title":
            return { content: document.title || "(无标题)" };

          case "get_selection": {
            // 获取用户当前选中的文本
            const selection = window.getSelection();
            const text = selection?.toString().trim() ?? "";
            return { content: text || "(未选中任何文本)" };
          }

          case "get_viewport": {
            // 获取视口和滚动信息
            const info = {
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              pageWidth: document.documentElement.scrollWidth,
              pageHeight: document.documentElement.scrollHeight,
            };
            return { content: JSON.stringify(info, null, 2) };
          }

          case "snapshot": {
            // 生成 DOM 快照 — AI 理解当前页面结构的主要方式
            const maxDepth = (params.maxDepth as number) ?? 6;
            const snapshot = generateSnapshot(document.body, maxDepth);
            return { content: snapshot };
          }

          case "query_all": {
            // 查询所有匹配元素
            const selector = params.selector as string;
            if (!selector) return { content: "缺少 selector 参数" };
            return { content: queryAllElements(selector) };
          }

          default:
            return { content: `未知的页面信息动作: ${action}` };
        }
      } catch (err) {
        return {
          content: `页面信息操作 "${action}" 失败: ${err instanceof Error ? err.message : String(err)}`,
          details: { error: true, action },
        };
      }
    },
  };
}
