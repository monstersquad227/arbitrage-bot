import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import fetch, {
  type RequestInit as FetchInit,
  type Response as FetchResponse,
} from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  JUPITER_API_BASE,
  JUPITER_API_KEY,
  JUPITER_QUOTE_API_BASE,
  MAX_SLIPPAGE_BPS,
  PRIVATE_KEY_B58,
  PROXY_URL,
  REQUEST_TIMEOUT_MS,
  RPC_URL,
} from "./config.js";
import type { JupiterExecuteResponse, JupiterOrderResponse } from "./types.js";
import { Connection } from "@solana/web3.js";
import { proxyFetch } from "./proxyFetch.js";

export interface JupiterQuoteResult {
  outAmount: string;
  otherAmountThreshold: string;
}

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
};

const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

const MAX_FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function fetchWithProxy(
  url: string,
  init?: FetchInit
): Promise<FetchResponse> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...(init || {}),
        headers: {
          ...headers,
          ...(init?.headers as Record<string, string> | undefined),
        },
        agent: agent as any,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res;
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      const code = (e as { code?: string })?.code;
      if (attempt < MAX_FETCH_RETRIES && (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED")) {
        console.warn(`  网络请求失败 (${code})，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_FETCH_RETRIES})...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

/**
 * Get an unsigned swap order from Jupiter Ultra API.
 */
export async function getOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  taker: string;
  slippageBps?: number;
}): Promise<JupiterOrderResponse | { error: string }> {
  const url = new URL(`${JUPITER_API_BASE}/order`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("taker", params.taker);
  url.searchParams.set("slippageBps", String(params.slippageBps ?? MAX_SLIPPAGE_BPS));

  const res = await fetchWithProxy(url.toString());
  const data = (await res.json()) as JupiterOrderResponse | { error: string };
  const ok = res.status >= 200 && res.status < 300;

  if (!ok) {
    const err = "error" in data ? (data as { error: string }).error : `HTTP ${res.status}`;
    return { error: err };
  }
  if ("error" in data) {
    return data;
  }
  return data;
}

/**
 * Get a swap quote from Jupiter Swap API (no taker/balance check).
 * 用于扫描阶段估算 Step2 输出，避免 Ultra /order 因钱包暂无中间币而报 Insufficient funds。
 */
export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
}): Promise<JupiterQuoteResult | { error: string }> {
  const url = new URL(`${JUPITER_QUOTE_API_BASE}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps ?? MAX_SLIPPAGE_BPS));

  const res = await fetchWithProxy(url.toString());
  const data = (await res.json()) as JupiterQuoteResult | { error?: string; message?: string };
  const ok = res.status >= 200 && res.status < 300;

  if (!ok) {
    const err = "error" in data ? (data as { error: string }).error : ("message" in data ? (data as { message: string }).message : `HTTP ${res.status}`);
    return { error: err ?? `HTTP ${res.status}` };
  }
  if ("error" in data && data.error) {
    return { error: data.error };
  }
  if ("outAmount" in data && "otherAmountThreshold" in data) {
    return { outAmount: data.outAmount, otherAmountThreshold: data.otherAmountThreshold };
  }
  return { error: "Invalid quote response" };
}

/**
 * Sign and execute an order via Jupiter Ultra execute endpoint.
 */
export async function executeOrder(
  requestId: string,
  transactionBase64: string,
  wallet: Keypair
): Promise<JupiterExecuteResponse> {
  const txBuf = Buffer.from(transactionBase64, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  const res = await fetchWithProxy(`${JUPITER_API_BASE}/execute`, {
    method: "POST",
    body: JSON.stringify({
      requestId,
      signedTransaction: signedBase64,
    }),
  });
  return (await res.json()) as JupiterExecuteResponse;
}

/** Swap API v1: quote response (pass-through to /swap). */
export type JupiterQuoteSwapV1Response = Record<string, unknown>;

/**
 * Jupiter Swap API v1: get quote for full path (e.g. USDC -> A -> B -> USDC).
 * Uses restrictIntermediateTokens=false so router can use any intermediates.
 */
export async function getQuoteSwapV1(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps?: number;
  restrictIntermediateTokens?: boolean;
}): Promise<JupiterQuoteSwapV1Response | { error: string }> {
  const url = new URL(`${JUPITER_QUOTE_API_BASE}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  url.searchParams.set("slippageBps", String(params.slippageBps ?? MAX_SLIPPAGE_BPS));
  url.searchParams.set("restrictIntermediateTokens", String(params.restrictIntermediateTokens ?? false));

  const res = await fetchWithProxy(url.toString());
  const data = (await res.json()) as JupiterQuoteSwapV1Response | { error?: string; message?: string };
  const ok = res.status >= 200 && res.status < 300;

  if (!ok) {
    const err = "error" in data ? (data as { error: string }).error : ("message" in data ? (data as { message: string }).message : `HTTP ${res.status}`);
    return { error: err ?? `HTTP ${res.status}` };
  }
  if ("error" in data && data.error) {
    return { error: data.error };
  }
  return data as JupiterQuoteSwapV1Response;
}

/**
 * Jupiter Swap API v1: build unsigned swap transaction from quote.
 */
export async function getSwapTransactionSwapV1(params: {
  quoteResponse: JupiterQuoteSwapV1Response;
  userPublicKey: string;
}): Promise<{ swapTransaction: string } | { error: string }> {
  const res = await fetchWithProxy(`${JUPITER_QUOTE_API_BASE}/swap`, {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
    }),
  });
  const data = (await res.json()) as { swapTransaction?: string; error?: string; message?: string };
  const ok = res.status >= 200 && res.status < 300;

  if (!ok) {
    const err = data.error ?? data.message ?? `HTTP ${res.status}`;
    return { error: err };
  }
  if (data.error) {
    return { error: data.error };
  }
  if (!data.swapTransaction) {
    return { error: "No swapTransaction in response" };
  }
  return { swapTransaction: data.swapTransaction };
}

/**
 * Sign and send a Swap API v1 transaction (single atomic swap).
 */
export async function executeSwapV1(
  swapTransactionBase64: string,
  wallet: Keypair
): Promise<{ signature: string } | { error: string }> {
  try {
    const txBuf = Buffer.from(swapTransactionBase64, "base64");
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);
    const connection = new Connection(RPC_URL, { fetch: proxyFetch as any });
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    return { signature: sig };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

/**
 * Get wallet Keypair from env PRIVATE_KEY (base58).
 */
export function getWallet(): Keypair {
  if (!PRIVATE_KEY_B58) {
    throw new Error("PRIVATE_KEY is not set in .env");
  }
  return Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_B58));
}
