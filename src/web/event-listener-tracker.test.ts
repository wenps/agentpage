import { afterEach, describe, expect, it, vi } from "vitest";

describe("event-listener-tracker", () => {
  const originalElement = (globalThis as { Element?: unknown }).Element;

  class MockElement extends EventTarget {}

  afterEach(() => {
    vi.resetModules();
    if (originalElement === undefined) {
      delete (globalThis as { Element?: unknown }).Element;
    } else {
      (globalThis as { Element?: unknown }).Element = originalElement;
    }
  });

  it("记录 Element 上 add/removeEventListener 的事件名", async () => {
    (globalThis as { Element?: unknown }).Element = MockElement;

    const tracker = await import("./event-listener-tracker.js");
    tracker.installEventListenerTracking();

    const el = new MockElement() as unknown as Element;
    const listener = () => {};

    el.addEventListener("click", listener);
    el.addEventListener("input", listener);

    expect(tracker.hasTrackedElementEvents(el)).toBe(true);
    expect(tracker.getTrackedElementEvents(el)).toEqual(["click", "input"]);

    el.removeEventListener("click", listener);
    expect(tracker.getTrackedElementEvents(el)).toEqual(["input"]);

    el.removeEventListener("input", listener);
    expect(tracker.getTrackedElementEvents(el)).toEqual([]);
    expect(tracker.hasTrackedElementEvents(el)).toBe(false);
  });

  it("不记录非 Element 的 EventTarget", async () => {
    (globalThis as { Element?: unknown }).Element = MockElement;

    const tracker = await import("./event-listener-tracker.js");
    tracker.installEventListenerTracking();

    const target = new EventTarget();
    const listener = () => {};

    target.addEventListener("click", listener);

    const anotherEl = new MockElement() as unknown as Element;
    expect(tracker.getTrackedElementEvents(anotherEl)).toEqual([]);
    expect(tracker.hasTrackedElementEvents(anotherEl)).toBe(false);
  });
});
