/**
 * DOM Tool — 基于 Web API 的 DOM 操作工具。
 *
 * 替代 Playwright 的 click/fill/type 等操作，直接在页面上下文中执行。
 * 运行环境：浏览器 Content Script。
 *
 * 支持 8 种动作：
 *   click        — 点击元素
 *   fill         — 填写输入框（清空后设值）
 *   type         — 逐字符模拟键入
 *   get_text     — 获取元素文本内容
 *   get_attr     — 获取元素属性值
 *   set_attr     — 设置元素属性
 *   add_class    — 添加 CSS 类名
 *   remove_class — 移除 CSS 类名
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";

/**
 * 安全地查询 DOM 元素，返回匹配的元素或错误信息。
 */
function queryElement(selector: string): Element | string {
  try {
    const el = document.querySelector(selector);
    if (!el) return `未找到匹配 "${selector}" 的元素`;
    return el;
  } catch (e) {
    return `选择器语法错误: ${selector}`;
  }
}

/**
 * 模拟真实用户输入：触发 input、change 事件，兼容 React/Vue 等框架。
 */
function dispatchInputEvents(el: HTMLInputElement | HTMLTextAreaElement): void {
  el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
}

export function createDomTool(): ToolDefinition {
  return {
    name: "dom",
    description: [
      "Perform DOM operations on the current page.",
      "Actions: click, fill, type, get_text, get_attr, set_attr, add_class, remove_class.",
      "All actions require a CSS selector to target the element.",
    ].join(" "),

    schema: Type.Object({
      action: Type.String({
        description:
          "DOM action: click | fill | type | get_text | get_attr | set_attr | add_class | remove_class",
      }),
      selector: Type.String({ description: "CSS selector to target the element" }),
      value: Type.Optional(
        Type.String({ description: "Value for fill/type/set_attr actions" }),
      ),
      attribute: Type.Optional(
        Type.String({ description: "Attribute name for get_attr/set_attr actions" }),
      ),
      className: Type.Optional(
        Type.String({ description: "CSS class name for add_class/remove_class" }),
      ),
    }),

    execute: async (params): Promise<ToolCallResult> => {
      const action = params.action as string;
      const selector = params.selector as string;

      if (!selector) return { content: "缺少 selector 参数" };

      const elOrError = queryElement(selector);
      if (typeof elOrError === "string") return { content: elOrError };
      const el = elOrError;

      try {
        switch (action) {
          // ─── 交互类 ───

          case "click": {
            // 模拟点击：先 focus 再 click，触发完整事件链
            if (el instanceof HTMLElement) {
              el.focus();
              el.click();
            } else {
              el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
            return { content: `已点击 "${selector}"` };
          }

          case "fill": {
            // 填写输入框：清空原有值 → 设置新值 → 触发 input/change 事件
            const value = params.value as string;
            if (value === undefined) return { content: "缺少 value 参数" };

            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.focus();
              el.value = value;
              dispatchInputEvents(el);
            } else if (el instanceof HTMLElement && el.isContentEditable) {
              el.focus();
              el.textContent = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
              return { content: `"${selector}" 不是可编辑元素` };
            }
            return { content: `已填写 "${selector}": "${value}"` };
          }

          case "type": {
            // 逐字符键入：每个字符触发 keydown → keypress → input → keyup
            // 适用于有实时监听键盘事件的输入框（如搜索自动补全）
            const value = params.value as string;
            if (value === undefined) return { content: "缺少 value 参数" };

            if (el instanceof HTMLElement) el.focus();

            for (const char of value) {
              el.dispatchEvent(
                new KeyboardEvent("keydown", { key: char, bubbles: true }),
              );
              el.dispatchEvent(
                new KeyboardEvent("keypress", { key: char, bubbles: true }),
              );
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.value += char;
              }
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(
                new KeyboardEvent("keyup", { key: char, bubbles: true }),
              );
            }
            return { content: `已逐字输入到 "${selector}": "${value}"` };
          }

          // ─── 读取类 ───

          case "get_text": {
            // 获取元素的文本内容（包括子元素）
            const text = el.textContent?.trim() ?? "";
            return { content: text || "(空)" };
          }

          case "get_attr": {
            // 获取元素的指定属性值
            const attribute = params.attribute as string;
            if (!attribute) return { content: "缺少 attribute 参数" };
            const attrValue = el.getAttribute(attribute);
            return { content: attrValue ?? `属性 "${attribute}" 不存在` };
          }

          // ─── 修改类 ───

          case "set_attr": {
            // 设置元素的属性值
            const attribute = params.attribute as string;
            const value = params.value as string;
            if (!attribute || value === undefined)
              return { content: "缺少 attribute 或 value 参数" };
            el.setAttribute(attribute, value);
            return { content: `已设置 "${selector}" 的 ${attribute}="${value}"` };
          }

          case "add_class": {
            // 给元素添加 CSS 类名
            const className = params.className as string;
            if (!className) return { content: "缺少 className 参数" };
            el.classList.add(className);
            return { content: `已添加 class "${className}" 到 "${selector}"` };
          }

          case "remove_class": {
            // 移除元素的 CSS 类名
            const className = params.className as string;
            if (!className) return { content: "缺少 className 参数" };
            el.classList.remove(className);
            return { content: `已移除 "${selector}" 的 class "${className}"` };
          }

          default:
            return { content: `未知的 DOM 动作: ${action}` };
        }
      } catch (err) {
        return {
          content: `DOM 操作 "${action}" 失败: ${err instanceof Error ? err.message : String(err)}`,
          details: { error: true, action, selector },
        };
      }
    },
  };
}
