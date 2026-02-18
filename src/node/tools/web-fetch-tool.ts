/**
 * Web Fetch Tool — 网页内容抓取工具，让 AI 能"阅读"网页。
 *
 * 用途：AI 可以抓取任意 URL 的内容，用于阅读文章、查看文档、获取 API 响应等。
 *
 * 处理流程：
 *   URL → fetch() 请求 → 判断内容类型
 *     → HTML? → stripHtmlTags() 清理 → 返回纯文本
 *     → 非 HTML（JSON/文本）? → 直接返回原文
 *
 * 安全与限制：
 * - 超时 15 秒（AbortController），防止慢站点阻塞 Agent
 * - 内容上限 40,000 字符，超过则截断
 * - 自定义 User-Agent 标识 AutoPilot
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ToolCallResult } from "../../core/tool-registry.js";

/** 返回内容最大字符数 */
const MAX_CONTENT_CHARS = 40_000;
/** 请求超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 截断过长内容，只保留前 maxChars 个字符 */
function truncateContent(text: string, maxChars: number = MAX_CONTENT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n…[truncated]";
}

/**
 * 轻量级 HTML 清理 — 不依赖任何第三方库。
 *
 * 清理顺序：
 * 1. 移除 <script>、<style>、<nav>、<footer>、<header> 整块（对 AI 理解正文无用）
 * 2. 剥离所有剩余 HTML 标签
 * 3. 解码常见 HTML 实体（&amp; → &，&lt; → < 等）
 * 4. 合并多余空白
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")   // 移除脚本
    .replace(/<style[\s\S]*?<\/style>/gi, "")     // 移除样式
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")         // 移除导航栏
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")   // 移除页脚
    .replace(/<header[\s\S]*?<\/header>/gi, "")   // 移除页头
    .replace(/<[^>]+>/g, " ")                      // 剥离所有 HTML 标签
    .replace(/&nbsp;/g, " ")                       // 以下：解码 HTML 实体
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")                          // 合并多余空白
    .trim();
}

export function createWebFetchTool(): ToolDefinition {
  return {
    name: "web_fetch",
    description: [
      "Fetch the content of a web page and extract readable text.",
      "Returns the main text content, stripping navigation, scripts, and styles.",
      "Use for reading articles, documentation, or web page content.",
    ].join(" "),
    schema: Type.Object({
      url: Type.String({ description: "The URL to fetch" }),
      maxChars: Type.Optional(Type.Number({ description: "Max characters to return (default 40000)" })),
    }),
    execute: async (params): Promise<ToolCallResult> => {
      const url = params.url as string;
      const maxChars = (params.maxChars as number) ?? MAX_CONTENT_CHARS;

      try {
        // 设置 15 秒超时：超时后 abort 请求
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        // 发起 HTTP 请求，自动跟随重定向
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "AutoPilot/0.1 (web-fetch tool)",
            Accept: "text/html, application/xhtml+xml, text/plain, */*",
          },
          redirect: "follow",
        });

        clearTimeout(timer);

        if (!response.ok) {
          return {
            content: `HTTP ${response.status} ${response.statusText}`,
            details: { error: true, url, status: response.status },
          };
        }

        // 根据 Content-Type 决定处理方式
        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();

        let text: string;
        if (contentType.includes("text/html") || contentType.includes("xhtml")) {
          // HTML 内容 → 清理标签，提取纯文本
          text = stripHtmlTags(body);
        } else {
          // JSON、纯文本等 → 直接使用原文
          text = body;
        }

        return {
          content: truncateContent(text, maxChars),
          details: { url, status: response.status, chars: text.length },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `Failed to fetch ${url}: ${message}`,
          details: { error: true, url },
        };
      }
    },
  };
}
