import { Connection, PublicKey } from "@solana/web3.js";
import { MIN_SOL_LAMPORTS, RPC_URL, TRADE_AMOUNT_RAW } from "./config.js";
import { proxyFetch } from "./proxyFetch.js";

export interface WalletBalance {
  solLamports: number;
  ok: boolean;
  message?: string;
}

/** 套利路径为 SOL -> 中间 -> SOL，只需检查 SOL 余额（套利用量 + gas 预留） */
const SOL_NEEDED_RAW = Number(TRADE_AMOUNT_RAW) + MIN_SOL_LAMPORTS;

/**
 * 预检查钱包余额：SOL 是否满足本轮套利（交易用量 + gas）。
 */
export async function checkWalletBalance(
  walletPublicKey: PublicKey
): Promise<WalletBalance> {
  const connection = new Connection(RPC_URL, { fetch: proxyFetch as any });
  let solLamports = 0;

  try {
    solLamports = await connection.getBalance(walletPublicKey);
  } catch (e) {
    return {
      solLamports: 0,
      ok: false,
      message: "获取 SOL 余额失败: " + (e instanceof Error ? e.message : String(e)),
    };
  }

  const ok = solLamports >= SOL_NEEDED_RAW;
  const message = ok
    ? undefined
    : "SOL 不足(需 ≥ " + (SOL_NEEDED_RAW / 1e9).toFixed(4) + " SOL，含套利+gas)";

  return {
    solLamports,
    ok,
    message,
  };
}

export function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(6);
}

