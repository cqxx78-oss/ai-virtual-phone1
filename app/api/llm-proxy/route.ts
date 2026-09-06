import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

export const maxDuration = 120;

function getProxyDispatcher(): Dispatcher | undefined {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY;
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function blockedProxyUrlReason(rawUrl: string): string | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return "URL 格式不合法"; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "只允许 http/https URL";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6Literal = host.includes(":");
  const blocked = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
    || host === "::1" || host === "0:0:0:0:0:0:0:1"
    || (isIpv6Literal && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")))
    || isPrivateIpv4(host);
  return blocked ? "不允许代理访问本机或内网地址" : null;
}

/**
 * POST /api/llm-proxy
 * 服务端 LLM 代理转发：兼容普通 JSON 响应和 SSE 流式响应。
 */
export async function POST(req: NextRequest) {
  try {
    const { url, method, headers, body, stream } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    const blockedReason = blockedProxyUrlReason(url);
    if (blockedReason) {
      return NextResponse.json({ error: blockedReason }, { status: 400 });
    }

    const dispatcher = getProxyDispatcher();
    const fetchHeaders: Record<string, string> = { ...(headers || {}) };
    if (stream) fetchHeaders["Accept"] = "text/event-stream";

    const fetchOptions: RequestInit & { dispatcher?: Dispatcher } = {
      method: method || "POST",
      headers: fetchHeaders,
      dispatcher,
    };
    if (body !== undefined && body !== null && (method || "POST") !== "GET") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upstreamRes = await (dispatcher ? undiciFetch(url, fetchOptions as any) : fetch(url, fetchOptions as RequestInit));

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      return NextResponse.json({ error: `上游错误 ${upstreamRes.status}: ${errorText.slice(0, 500)}` }, { status: 502 });
    }

    if (stream) {
      const resHeaders = new Headers();
      resHeaders.set("Content-Type", "text/event-stream");
      resHeaders.set("Cache-Control", "no-cache");
      resHeaders.set("Connection", "keep-alive");

      const upstreamBody = upstreamRes.body;
      if (!upstreamBody) {
        return NextResponse.json({ error: "上游没有响应体" }, { status: 502 });
      }

      return new Response(upstreamBody as ReadableStream, {
        status: 200,
        headers: resHeaders,
      });
    }

    const text = await upstreamRes.text();
    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `LLM 代理错误: ${msg}` }, { status: 502 });
  }
}
