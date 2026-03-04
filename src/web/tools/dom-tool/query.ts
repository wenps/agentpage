/**
 * DOM Tool — 元素查询与描述工具函数。
 *
 * 包含：RefStore 管理、queryElement（含复合 hash 选择器）、等待轮询、元素描述。
 */
import type { RefStore } from "../../ref-store.js";
import { DEFAULT_WAIT_MS } from "./constants.js";

// ─── 模块状态 ───

let activeRefStore: RefStore | undefined;

export function setActiveRefStore(store: RefStore | undefined): void {
  activeRefStore = store;
}

export function getActiveRefStore(): RefStore | undefined {
  return activeRefStore;
}

// ─── 基础工具 ───

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 查询元素：优先 RefStore hash，回退 CSS 选择器。
 * 支持复合 hash 选择器（如 "#hashID .child-class"）——先解析 hash 根，再在其子树内 querySelector。
 */
export function queryElement(selector: string): Element | string {
  try {
    if (selector.startsWith("#") && activeRefStore) {
      // 尝试拆分复合选择器："#hashID .rest" → hashPart + rest
      const spaceIdx = selector.indexOf(" ");
      const hashPart = spaceIdx > 0 ? selector.slice(1, spaceIdx) : selector.slice(1);
      const rest = spaceIdx > 0 ? selector.slice(spaceIdx + 1).trim() : "";

      if (activeRefStore.has(hashPart)) {
        const root = activeRefStore.get(hashPart);
        if (!root || !root.isConnected) {
          activeRefStore.delete(hashPart);
          return `未找到 ref "#${hashPart}" 对应的元素（可能已被移除或快照已过期）`;
        }
        // 无后续选择器，直接返回
        if (!rest) return root;
        // 复合查询：在 hash 根内继续 querySelector
        const child = root.querySelector(rest);
        if (!child) return `在 #${hashPart} 内未找到匹配 "${rest}" 的子元素`;
        return child;
      }
    }
    const el = document.querySelector(selector);
    if (!el) return `未找到匹配 "${selector}" 的元素`;
    return el;
  } catch {
    return `选择器语法错误: ${selector}`;
  }
}

/** 轮询等待元素出现 */
export async function waitForElement(selector: string, timeoutMs: number): Promise<Element | string | null> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const r = queryElement(selector);
    if (typeof r !== "string") return r;
    if (r.startsWith("选择器语法错误")) return r;
    await sleep(100);
  }
  return null;
}

export function resolveWaitMs(params: Record<string, unknown>): number {
  const waitMs = params.waitMs;
  if (typeof waitMs === "number" && Number.isFinite(waitMs)) return Math.max(0, Math.floor(waitMs));
  const waitSeconds = params.waitSeconds;
  if (typeof waitSeconds === "number" && Number.isFinite(waitSeconds)) return Math.max(0, Math.floor(waitSeconds * 1000));
  return DEFAULT_WAIT_MS;
}

// ─── 元素描述 ───

/** 生成元素的简洁描述字符串，用于工具调用结果的可读输出。 */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string"
    ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(c => `.${c}`).join("") : "";
  const text = el instanceof HTMLSelectElement
    ? el.selectedOptions[0]?.textContent?.trim().slice(0, 40) ?? ""
    : el.textContent?.trim().slice(0, 40) ?? "";
  const textHint = text ? ` "${text}"` : "";
  const hints: string[] = [];
  for (const attr of ["type", "name", "placeholder", "href", "role"]) {
    const v = el.getAttribute(attr);
    if (v) hints.push(`${attr}=${v}`);
  }
  if (el instanceof HTMLSelectElement && el.value) hints.push(`val=${el.value}`);
  const attrHint = hints.length > 0 ? ` [${hints.join(", ")}]` : "";
  return `<${tag}${id}${cls}>${textHint}${attrHint}`;
}
