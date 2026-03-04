/**
 * DOM Tool — 自定义下拉增强。
 *
 * 包含：全局可见 option 查找、下拉弹出等待。
 */
import { isElementVisible } from "./actionability.js";
import { sleep } from "./query.js";

/** 在全局可见 option 节点中按文本匹配（精确 → 包含） */
export function findVisibleOptionByText(text: string): HTMLElement | null {
  const target = text.trim().toLowerCase();
  if (!target) return null;
  const selectors = [
    '[role="option"]', '[role="listbox"] li',
    ".el-select-dropdown__item", ".el-option",     // Element Plus
    ".ant-select-item-option",                     // Ant Design
    ".el-cascader-node", ".el-dropdown-menu__item",
    '[class*="option"]', "li[data-value]", "option",
  ].join(", ");
  const nodes = Array.from(document.querySelectorAll(selectors));
  const visible = nodes.filter(n => n instanceof HTMLElement && isElementVisible(n));
  for (const n of visible) { if (n.textContent?.trim().toLowerCase() === target) return n as HTMLElement; }
  for (const n of visible) { if (n.textContent?.trim().toLowerCase().includes(target)) return n as HTMLElement; }
  return null;
}

/** 轮询等待下拉弹出层出现 */
export async function waitForDropdownPopup(maxWait = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const popup = document.querySelector('[role="listbox"], .el-select-dropdown, .el-popper, .ant-select-dropdown, [class*="dropdown"]');
    if (popup && isElementVisible(popup)) return;
    await sleep(50);
  }
}
