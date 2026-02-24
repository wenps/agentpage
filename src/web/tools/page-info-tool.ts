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
 * 每个元素自动生成基于层级位置的 XPath 引用（ref），
 * AI 可以通过 ref 精确定位元素，无需猜测 CSS 选择器。
 *
 * 输出格式示例：
 *   [header] ref="/body/header"
 *     [nav] ref="/body/header/nav"
 *       [a] "首页" href="/" ref="/body/header/nav/a[1]"
 *       [a] "关于" href="/about" ref="/body/header/nav/a[2]"
 *   [main] ref="/body/main"
 *     [h1] "欢迎来到示例网站" ref="/body/main/h1"
 *     [input] type="text" placeholder="搜索..." ref="/body/main/input"
 *     [button] "搜索" id="search-btn" onclick ref="/body/main/button"
 *
 * 增强信息：
 * - id：元素的 id 属性
 * - placeholder：输入框的占位文本
 * - 事件绑定：onclick/onchange 等内联事件处理器
 * - 状态属性：disabled/checked/readonly/required 等
 */
export function generateSnapshot(root: Element = document.body, maxDepth = 6): string {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "SVG", "NOSCRIPT", "LINK", "META", "BR", "HR",
  ]);

  const INTERACTIVE_ATTRS = [
    "href", "type", "placeholder", "value", "name", "role", "aria-label",
    "src", "alt", "title", "for", "action", "method", "target", "min", "max",
    "pattern", "maxlength", "tabindex",
  ];

  /** 布尔状态属性 — 只在存在时输出（无值），如 disabled、checked */
  const BOOLEAN_ATTRS = [
    "disabled", "checked", "readonly", "required", "selected",
    "hidden", "multiple", "autofocus", "open",
  ];

  /** 内联事件属性前缀 */
  const EVENT_PREFIX = "on";

  /**
   * 计算元素在父节点中同标签兄弟里的序号（1-based，XPath 规范）。
   * 如果同标签兄弟只有一个，返回空字符串（无需索引消歧）。
   */
  function getSiblingIndex(el: Element): string {
    const parent = el.parentElement;
    if (!parent) return "";
    const tag = el.tagName;
    const siblings = Array.from(parent.children).filter((c) => c.tagName === tag);
    if (siblings.length <= 1) return "";
    return `[${siblings.indexOf(el) + 1}]`;
  }

  function walk(el: Element, depth: number, parentPath: string): string {
    if (depth > maxDepth) return "";
    if (SKIP_TAGS.has(el.tagName)) return "";

    // 跳过不可见元素
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return "";

    const indent = "  ".repeat(depth);
    const tag = el.tagName.toLowerCase();

    // 构建当前元素的 XPath
    const index = getSiblingIndex(el);
    const currentPath = `${parentPath}/${tag}${index}`;

    // 收集有意义的属性
    const attrs: string[] = [];

    // 1. id — 最重要的标识信息，优先展示
    const elId = el.getAttribute("id");
    if (elId) attrs.push(`id="${elId}"`);

    // 2. class — 关键 CSS 类名（最多 3 个）
    const className = el.getAttribute("class")?.trim();
    if (className) {
      const classes = className.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
      if (classes) attrs.push(`class="${classes}"`);
    }

    // 3. 交互属性（href, type, placeholder 等）
    for (const attr of INTERACTIVE_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) attrs.push(`${attr}="${val}"`);
    }

    // 4. 布尔状态属性（disabled, checked 等）
    for (const attr of BOOLEAN_ATTRS) {
      if (el.hasAttribute(attr)) attrs.push(attr);
    }

    // 5. 事件绑定 — 检测内联事件处理器（onclick, onchange 等）
    const events: string[] = [];
    for (const attrObj of Array.from(el.attributes)) {
      if (attrObj.name.startsWith(EVENT_PREFIX)) {
        events.push(attrObj.name);
      }
    }
    if (events.length > 0) attrs.push(`events=[${events.join(",")}]`);

    // 6. data-* 属性（常用于框架绑定，最多 3 个）
    const dataAttrs: string[] = [];
    for (const attrObj of Array.from(el.attributes)) {
      if (attrObj.name.startsWith("data-") && dataAttrs.length < 3) {
        dataAttrs.push(`${attrObj.name}="${attrObj.value.slice(0, 30)}"`);
      }
    }
    if (dataAttrs.length > 0) attrs.push(...dataAttrs);

    // 7. 对于 input/textarea，补充当前实际 value（与 attribute 值可能不同）
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value) {
      const currentVal = el.value.slice(0, 60);
      // 只在 attribute 中没有 value 或 value 不同时补充
      const attrVal = el.getAttribute("value");
      if (attrVal !== currentVal) {
        attrs.push(`current-value="${currentVal}"`);
      }
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

    // 构建当前元素描述：[标签] "文本" 属性 ref="XPath"
    let line = `${indent}[${tag}]`;
    if (directText) line += ` "${directText.slice(0, 80)}"`;
    if (attrs.length) line += ` ${attrs.join(" ")}`;
    line += ` ref="${currentPath}"`;

    const lines: string[] = [line];

    // 递归子元素
    for (let i = 0; i < el.children.length; i++) {
      const childResult = walk(el.children[i], depth + 1, currentPath);
      if (childResult) lines.push(childResult);
    }

    return lines.join("\n");
  }

  // 根元素自身的标签作为路径起点，walk 内部不再重复追加
  // 例如 root=body 时，parentPath=""，walk 中 currentPath="/body"
  return walk(root, 0, "") || "(空页面)";
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
