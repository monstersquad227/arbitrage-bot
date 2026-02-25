import "dotenv/config";

const LAMPORTS_PER_SOL = 1e9;

/** Minimum profit (after fees) as decimal, e.g. 0.001 = 0.1% */
export const MIN_PROFIT_BPS = 10; // 0.1% = 10 bps

/** 每笔套利金额（SOL），路径为 SOL -> 中间 -> SOL */
export const TRADE_AMOUNT_SOL = Number(process.env.TRADE_AMOUNT_SOL) || 0.01;

/** 每笔套利金额（lamports） */
export const TRADE_AMOUNT_RAW = BigInt(
  Math.floor(TRADE_AMOUNT_SOL * LAMPORTS_PER_SOL)
);

/** Max slippage in basis points (50 = 0.5%) */
export const MAX_SLIPPAGE_BPS = 10;

export const JUPITER_API_BASE = "https://api.jup.ag/ultra/v1";
/** Swap Quote API（仅报价，不校验钱包余额，用于扫描阶段 Step2 估算） */
export const JUPITER_QUOTE_API_BASE = "https://api.jup.ag/swap/v1";
export const JUPITER_API_KEY = process.env.JUPITER_API_KEY ?? "";
export const PRIVATE_KEY_B58 = process.env.PRIVATE_KEY ?? "";
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;

/** PART1: 不要真正的交易 — 仅检测并打印套利机会，不提交链上交易 */
export const DRY_RUN = process.env.DRY_RUN === "1" || process.env.PART1 === "1";

/** 网络请求代理，默认 http://127.0.0.1:7890；设为空字符串表示不使用代理 */
export const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:7890";
/** 请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

/** Solana RPC（预检查余额用）；可设代理或公网 RPC */
export const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";

/** 预检查：要求钱包至少保留的 SOL（lamports），用于 gas，约 0.005 SOL */
export const MIN_SOL_LAMPORTS = 5_000_000;

/** Solana USDC mint */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Native SOL mint */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** 三角套利路径 SOL -> 中间 -> SOL 的中间代币 */
export const INTERMEDIATE_MINTS = [
  USDC_MINT,
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
];

/** Mint -> 显示名称（用于日志） */
export const MINT_LABEL: Record<string, string> = {
  [SOL_MINT]: "SOL",
  [USDC_MINT]: "USDC",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "BONK",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
};

export function getMinProfitRaw(): bigint {
  // 0.1% of trade amount, in lamports
  return (TRADE_AMOUNT_RAW * BigInt(MIN_PROFIT_BPS)) / BigInt(10_000);
}
