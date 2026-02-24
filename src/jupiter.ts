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
  MAX_SLIPPAGE_BPS,
  PRIVATE_KEY_B58,
  PROXY_URL,
  REQUEST_TIMEOUT_MS,
  TRADE_AMOUNT_RAW,
} from "./config.js";
import type { JupiterExecuteResponse, JupiterOrderResponse } from "./types.js";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  ...(JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {}),
};

const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

async function fetchWithProxy(
  url: string,
  init?: FetchInit
): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...(init || {}),
      headers: {
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent: agent as any,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
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

/**
 * Get wallet Keypair from env PRIVATE_KEY (base58).
 */
export function getWallet(): Keypair {
  if (!PRIVATE_KEY_B58) {
    throw new Error("PRIVATE_KEY is not set in .env");
  }
  return Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_B58));
}

export { TRADE_AMOUNT_RAW };
