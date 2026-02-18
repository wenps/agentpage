/**
 * Web Search Tool — 网页搜索工具，让 AI 能搜索互联网获取实时信息。
 *
 * 使用 Brave Search API（隐私友好的搜索引擎）进行搜索。
 * 需要 BRAVE_API_KEY 环境变量（免费额度：每月 2000 次）。
 *
 * 流程：
 *   AI 传入 query → 调用 Brave Search REST API → 返回标题 + URL + 摘要列表
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";

/** Brave Search API 返回的单条搜索结果结构 */
type BraveSearchResult = {
  title: string;
  url: string;
  description: string;
};

export function createWebSearchTool(): ToolDefinition {
  return {
    name: "web_search",
    description: [
      "Search the web using Brave Search API.",
      "Returns a list of search results with title, URL, and description.",
      "Requires BRAVE_API_KEY environment variable or config.tools.webSearch.apiKey.",
    ].join(" "),
    schema: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ description: "Number of results (default 5, max 20)" })),
    }),
    execute: async (params): Promise<ToolCallResult> => {
      const query = params.query as string;
      const count = Math.min((params.count as number) ?? 5, 20);

      // 从环境变量获取 API Key
      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        return {
          content: "BRAVE_API_KEY not set. Configure via environment variable or `autopilot config set tools.webSearch.apiKey <key>`.",
          details: { error: true },
        };
      }

      try {
        // 构建 Brave Search API 请求 URL
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);       // 搜索关键词
        url.searchParams.set("count", String(count)); // 结果数量

        // 调用 Brave Search REST API
        const response = await fetch(url.toString(), {
          headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,  // Brave 的认证方式
          },
        });

        if (!response.ok) {
          return {
            content: `Brave Search API error: HTTP ${response.status}`,
            details: { error: true, status: response.status },
          };
        }

        const data = await response.json() as { web?: { results?: BraveSearchResult[] } };
        const results = data.web?.results ?? [];

        if (results.length === 0) {
          return { content: `No results found for: ${query}` };
        }

        // 把搜索结果格式化为编号列表，方便 AI 阅读
        // 格式：1. **标题**\n   URL\n   描述
        const formatted = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`,
        ).join("\n\n");

        return {
          content: formatted,
          details: { query, resultCount: results.length },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `Web search failed: ${message}`,
          details: { error: true, query },
        };
      }
    },
  };
}
