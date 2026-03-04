/**
 * DOM Tool — 事件派发与键盘操作。
 *
 * 包含：完整点击事件链、hover 事件链、input/change 派发、
 *       原生 setter 写入、selectText、组合键 press。
 */
import { KEY_CODE_MAP } from "./constants.js";

// ─── 点击坐标 ───

function getClickPoint(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ─── 点击事件链（参考 Playwright Mouse.click） ───

/**
 * 完整点击事件链：
 * pointermove → mousemove → (per clickCount) pointerdown → mousedown → focus → pointerup → mouseup → click
 */
export function dispatchClickEvents(el: HTMLElement, clickCount = 1): void {
  const { x, y } = getClickPoint(el);
  const base: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };

  el.dispatchEvent(new PointerEvent("pointermove", { ...base, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent("mousemove", base));

  for (let cc = 1; cc <= clickCount; cc++) {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, detail: cc, buttons: 1, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, detail: cc, buttons: 1 }));
    if (cc === 1 && el !== document.activeElement) el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, detail: cc, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...base, detail: cc }));
    el.dispatchEvent(new MouseEvent("click", { ...base, detail: cc }));
  }
}

/** hover 事件链 */
export function dispatchHoverEvents(el: HTMLElement): void {
  const { x, y } = getClickPoint(el);
  const base: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
  el.dispatchEvent(new PointerEvent("pointerenter", { ...base, bubbles: false }));
  el.dispatchEvent(new MouseEvent("mouseenter", { ...base, bubbles: false }));
  el.dispatchEvent(new PointerEvent("pointermove", { ...base, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent("mousemove", base));
  el.dispatchEvent(new MouseEvent("mouseover", base));
}

/** 派发 input + change 事件（兼容 React/Vue 受控组件） */
export function dispatchInputEvents(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** 原生 setter 写入表单值（绕过 React/Vue getter/setter 拦截） */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

// ─── selectText（参考 Playwright：input/textarea/contenteditable 三种策略） ───

export function selectText(el: Element): void {
  if (el instanceof HTMLInputElement) { el.select(); el.focus(); return; }
  if (el instanceof HTMLTextAreaElement) { el.selectionStart = 0; el.selectionEnd = el.value.length; el.focus(); return; }
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  if (el instanceof HTMLElement) el.focus();
}

// ─── 键盘：组合键支持（参考 Playwright Keyboard.press） ───

export function splitKeyCombo(key: string): string[] {
  const tokens = key.split("+");
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "" && i + 1 < tokens.length) { tokens[i + 1] = "+" + tokens[i + 1]; tokens.splice(i, 1); }
  }
  return tokens.filter(Boolean);
}

export function resolveKeyCode(key: string): string {
  return KEY_CODE_MAP[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
}

/**
 * 执行 press：修饰键按正序 down → 主键 down/up → 修饰键逆序 up（参考 Playwright）。
 * 修饰键按下时抑制文本输入（只发 keydown/keyup，不发 keypress）。
 */
export function executePress(el: Element, key: string): void {
  const tokens = splitKeyCombo(key);
  const mainKey = tokens[tokens.length - 1];
  const mods = tokens.slice(0, -1);
  const modState = {
    ctrlKey: mods.includes("Control"),
    shiftKey: mods.includes("Shift"),
    altKey: mods.includes("Alt"),
    metaKey: mods.includes("Meta"),
  };
  const hasNonShiftMod = modState.ctrlKey || modState.altKey || modState.metaKey;

  for (const m of mods) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: m, code: resolveKeyCode(m), bubbles: true, cancelable: true, ...modState }));
  }
  const allowed = el.dispatchEvent(new KeyboardEvent("keydown", { key: mainKey, code: resolveKeyCode(mainKey), bubbles: true, cancelable: true, ...modState }));
  if (allowed && mainKey.length === 1 && !hasNonShiftMod) {
    el.dispatchEvent(new KeyboardEvent("keypress", { key: mainKey, code: resolveKeyCode(mainKey), bubbles: true, cancelable: true, ...modState }));
  }
  el.dispatchEvent(new KeyboardEvent("keyup", { key: mainKey, code: resolveKeyCode(mainKey), bubbles: true, cancelable: true, ...modState }));
  for (let i = mods.length - 1; i >= 0; i--) {
    el.dispatchEvent(new KeyboardEvent("keyup", { key: mods[i], code: resolveKeyCode(mods[i]), bubbles: true, cancelable: true, ...modState }));
  }
}
