/**
 * Interactive Mode Overlay — 给页面可交互元素加 outline 描边。
 *
 * 开启后扫描 document.body 下所有元素，按事件权重自动分级着色：
 * - 蓝色 #3b82f6：input 链路（input/change/focus/blur，权重 ≥100）
 * - 绿色 #22c55e：click 链路（click/dblclick/pointer/mouse，权重 45-99）
 * - 橙色 #f59e0b：touch/submit/其他（权重 < 45）
 * - 灰色 #9ca3af：无事件监听但语义交互（INTERACTIVE_TAGS/ROLES）
 *
 * 对话结束后批量移除。
 */

import { hasTrackedElementEvents, getTrackedElementEvents } from "../../../core/shared/event-listener-tracker.js";

// ─── 与 snapshot/engine.ts 同源的常量（engine 内部未导出，此处复刻） ───

const INTERACTIVE_TAGS = new Set([
  "A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION", "LABEL", "SUMMARY",
]);

const INTERACTIVE_ROLES = new Set([
  "button", "link", "tab", "switch", "slider", "checkbox", "radio",
  "combobox", "listbox", "option", "menuitem", "textbox", "spinbutton",
  "searchbox", "treeitem", "gridcell", "scrollbar",
]);

const EVENT_PRIORITY: Record<string, number> = {
  input: 140,
  change: 130,
  focus: 120,
  blur: 110,
  keydown: 100,
  keyup: 90,
  click: 80,
  dblclick: 70,
  pointerdown: 60,
  pointerup: 55,
  mousedown: 50,
  mouseup: 45,
  touchstart: 40,
  touchend: 35,
  submit: 30,
};

// ─── Overlay CSS ───

const OVERLAY_STYLE_ID = "data-ap-interactive-overlay";

const OVERLAY_CSS = `
[data-ap-overlay="input"]    { box-shadow: 0 0 0 2px #3b82f6 inset !important; }
[data-ap-overlay="click"]    { box-shadow: 0 0 0 2px #22c55e inset !important; }
[data-ap-overlay="touch"]    { box-shadow: 0 0 0 2px #f59e0b inset !important; }
[data-ap-overlay="semantic"] { box-shadow: 0 0 0 2px #9ca3af inset !important; }
`;

// ─── 模块状态 ───

let injectedStyle: HTMLStyleElement | null = null;

// ─── 工具函数 ───

/** 根据事件列表计算最高权重 */
function getMaxPriority(events: string[]): number {
  let max = 0;
  for (const name of events) {
    const p = EVENT_PRIORITY[name] ?? 8;
    if (p > max) max = p;
  }
  return max;
}

/** 根据最高权重确定颜色分级 */
function classifyPriority(maxPriority: number): "input" | "click" | "touch" {
  if (maxPriority >= 100) return "input";
  if (maxPriority >= 45) return "click";
  return "touch";
}

/** 判断元素是否为语义交互元素 */
function isSemanticInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  return false;
}

// ─── 导出函数 ───

/**
 * 扫描页面，给所有可交互元素加高亮 outline。
 */
export function applyInteractiveOverlay(): void {
  // 先清理上一次
  clearInteractiveOverlay();

  // 注入样式
  injectedStyle = document.createElement("style");
  injectedStyle.setAttribute(OVERLAY_STYLE_ID, "");
  injectedStyle.textContent = OVERLAY_CSS;
  document.head.appendChild(injectedStyle);

  // 遍历所有元素
  const allElements = document.body.querySelectorAll("*");
  for (const el of Array.from(allElements)) {
    if (!(el instanceof HTMLElement)) continue;

    const hasEvents = hasTrackedElementEvents(el);
    const isSemantic = isSemanticInteractive(el);

    if (!hasEvents && !isSemantic) continue;

    let category: string;

    if (hasEvents) {
      const events = getTrackedElementEvents(el);
      const maxPriority = getMaxPriority(events);
      category = classifyPriority(maxPriority);
    } else {
      category = "semantic";
    }

    el.setAttribute("data-ap-overlay", category);
  }
}

/**
 * 批量移除所有 overlay 状态。
 */
export function clearInteractiveOverlay(): void {
  if (injectedStyle) {
    injectedStyle.remove();
    injectedStyle = null;
  }

  // 移除所有 data-ap-overlay 属性
  const marked = document.querySelectorAll("[data-ap-overlay]");
  for (const el of Array.from(marked)) {
    el.removeAttribute("data-ap-overlay");
  }
}

/** 查询当前是否有活跃的 interactive overlay */
export function isInteractiveOverlayActive(): boolean {
  return injectedStyle !== null;
}
