/**
 * DOM Tool 常量定义。
 *
 * 包含：input 类型分类、修饰键集合、键码映射、滚动策略。
 */

/** 默认等待超时（ms） */
export const DEFAULT_WAIT_MS = 1200;

/** scrollIntoView 轮换策略（参考 Playwright dom.ts） */
export const SCROLL_OPTIONS: (ScrollIntoViewOptions | undefined)[] = [
  undefined,
  { block: "end", inline: "end" },
  { block: "center", inline: "center" },
  { block: "start", inline: "start" },
];

/** fill 时直接 setValue 的 input 类型（参考 Playwright kInputTypesToSetValue） */
export const INPUT_SET_VALUE_TYPES = new Set([
  "color", "date", "time", "datetime-local", "month", "range", "week",
]);

/** fill 时走 selectText+写入 的 input 类型 */
export const INPUT_TYPE_INTO_TYPES = new Set([
  "", "email", "number", "password", "search", "tel", "text", "url",
]);

/** 不可 fill 的 input 类型 */
export const INPUT_BLOCKED_TYPES = new Set([
  "checkbox", "radio", "file", "button", "submit", "reset", "image",
]);

/** 修饰键集合 */
export const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** 键名→code 映射 */
export const KEY_CODE_MAP: Record<string, string> = {
  Enter: "Enter", Escape: "Escape", Esc: "Escape",
  Tab: "Tab", Space: "Space", " ": "Space",
  Backspace: "Backspace", Delete: "Delete",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  Control: "ControlLeft", Shift: "ShiftLeft", Alt: "AltLeft", Meta: "MetaLeft",
};
