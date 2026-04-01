/**
 * Hover Force-Show — 注入临时样式表复刻 :hover 规则。
 *
 * 纯 CSS :hover 伪类控制的元素无法通过 JS 事件模拟触发显示，
 * 本模块遍历页面样式表，将 :hover 选择器替换为 [data-ap-hover] 属性选择器，
 * 注入临时 <style> 使目标元素及其祖先链上的 hover 样式立即生效。
 */

let injectedStyle: HTMLStyleElement | null = null;
let hoveredEl: HTMLElement | null = null;

/**
 * 强制显示 :hover 样式 — hover 后调用。
 *
 * 1. 清理上一次的 force hover
 * 2. 给目标元素及其祖先链标记 data-ap-hover
 * 3. 遍历所有样式表，将 :hover 规则复刻为 [data-ap-hover] 版本
 * 4. 注入临时 <style> 到 document.head
 */
export function forceHoverStyles(el: HTMLElement): void {
  cleanupHoverStyles();

  hoveredEl = el;

  // 给目标及所有祖先加 data-ap-hover（处理 .parent:hover .child 场景）
  let node: HTMLElement | null = el;
  while (node) {
    node.setAttribute("data-ap-hover", "");
    node = node.parentElement;
  }

  // 收集所有包含 :hover 的规则并替换
  const rules: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      // 跨域样式表无法访问，跳过
      continue;
    }
    collectHoverRules(cssRules, rules);
  }

  if (rules.length === 0) return;

  injectedStyle = document.createElement("style");
  injectedStyle.setAttribute("data-ap-hover-force", "");
  injectedStyle.textContent = rules.join("\n");
  document.head.appendChild(injectedStyle);
}

/** 递归收集 CSSRuleList 中的 :hover 规则 */
function collectHoverRules(cssRules: CSSRuleList, out: string[]): void {
  for (const rule of Array.from(cssRules)) {
    if (rule instanceof CSSStyleRule) {
      if (rule.selectorText.includes(":hover")) {
        const newSelector = rule.selectorText.replace(/:hover/g, "[data-ap-hover]");
        out.push(`${newSelector} { ${rule.style.cssText} }`);
      }
    } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      // 递归处理嵌套的 @media / @supports
      const nested: string[] = [];
      collectHoverRules(rule.cssRules, nested);
      if (nested.length > 0) {
        out.push(`${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{\n${nested.join("\n")}\n}`);
      }
    }
  }
}

/**
 * 清理所有 force hover 状态。
 *
 * 移除注入的 <style>、移除所有 data-ap-hover 属性、重置模块状态。
 */
export function cleanupHoverStyles(): void {
  if (injectedStyle) {
    injectedStyle.remove();
    injectedStyle = null;
  }

  // 移除所有 data-ap-hover 属性
  const marked = document.querySelectorAll("[data-ap-hover]");
  for (const el of Array.from(marked)) {
    el.removeAttribute("data-ap-hover");
  }

  hoveredEl = null;
}

/** 查询是否有活跃的 force hover */
export function hasActiveHoverForce(): boolean {
  return hoveredEl !== null;
}
