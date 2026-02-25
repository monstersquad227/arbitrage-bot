import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { PROXY_URL } from "./config.js";

const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

/**
 * 通过已配置代理发起的 fetch，供 Solana Connection / RPC 等使用。
 * 与 jupiter 请求共用 PROXY_URL。
 */
export function proxyFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  return fetch(url, {
    ...init,
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body as any,
    method: init?.method,
    agent: agent as any,
  });
}
