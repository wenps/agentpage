import { describe, expect, it } from "vitest";
import { RefStore } from "./ref-store.js";

describe("RefStore", () => {
  it("prune 会移除未保留和已失联引用", () => {
    const store = new RefStore("https://example.com");

    const connectedA = { isConnected: true } as unknown as Element;
    const connectedB = { isConnected: true } as unknown as Element;
    const disconnected = { isConnected: false } as unknown as Element;

    const idA = store.set(connectedA, "/body/div[1]");
    const idB = store.set(connectedB, "/body/div[2]");
    const idC = store.set(disconnected, "/body/div[3]");

    const removed = store.prune(new Set([idA, idC]));

    expect(removed).toBe(2);
    expect(store.has(idA)).toBe(true);
    expect(store.has(idB)).toBe(false);
    expect(store.has(idC)).toBe(false);
  });

  it("delete 可移除单个映射", () => {
    const store = new RefStore();
    const el = { isConnected: true } as unknown as Element;
    const id = store.set(el, "/body/main");

    expect(store.delete(id)).toBe(true);
    expect(store.delete(id)).toBe(false);
    expect(store.has(id)).toBe(false);
  });
});
