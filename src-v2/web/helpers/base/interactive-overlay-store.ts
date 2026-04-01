/**
 * Interactive Overlay 全局开关状态管理。
 *
 * 与 active-store.ts 同模式：模块级状态 + getter/setter。
 * 生命周期由 WebAgent.chat() 管理。
 */

let enabled = false;

export function setInteractiveOverlayEnabled(flag: boolean): void {
  enabled = flag;
}

export function getInteractiveOverlayEnabled(): boolean {
  return enabled;
}
