import { Connection, PublicKey } from "@solana/web3.js";
import { MIN_SOL_LAMPORTS, RPC_URL, USDC_MINT } from "./config.js";
import { proxyFetch } from "./proxyFetch.js";

export interface WalletBalance {
  solLamports: number;
  /** USDC 余额（最小单位 10^6），无 USDC 账户时为 0 */
  usdcRaw: number;
  ok: boolean;
  message?: string;
}

/** 仅需检查用于 gas 的 SOL 余额（USDC 为套利本金） */
const SOL_NEEDED_RAW = MIN_SOL_LAMPORTS;

/**
 * 预检查钱包余额：SOL 是否满足本轮套利（交易用量 + gas），并获取 USDC 余额。
 */
export async function checkWalletBalance(
  walletPublicKey: PublicKey
): Promise<WalletBalance> {
  const connection = new Connection(RPC_URL, { fetch: proxyFetch as any });
  let solLamports = 0;
  let usdcRaw = 0;

  try {
    solLamports = await connection.getBalance(walletPublicKey);
  } catch (e) {
    return {
      solLamports: 0,
      usdcRaw: 0,
      ok: false,
      message: "获取 SOL 余额失败: " + (e instanceof Error ? e.message : String(e)),
    };
  }

  try {
    const parsed = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
      mint: new PublicKey(USDC_MINT),
    });
    if (parsed.value.length > 0) {
      const amount = parsed.value[0].account.data.parsed?.info?.tokenAmount?.amount;
      if (amount != null) usdcRaw = Number(amount);
    }
  } catch (e) {
    // 不因 USDC 查询失败而跳过本轮，仅记录为 0
  }

  const ok = solLamports >= SOL_NEEDED_RAW;
  const message = ok
    ? undefined
    : "SOL 不足(需 ≥ " + (SOL_NEEDED_RAW / 1e9).toFixed(4) + " SOL，含套利+gas)";

  return {
    solLamports,
    usdcRaw,
    ok,
    message,
  };
}

export function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(6);
}

/** USDC 余额格式化（6 位小数） */
export function formatUsdcBalance(usdcRaw: number): string {
  return (usdcRaw / 1e6).toFixed(6);
}

