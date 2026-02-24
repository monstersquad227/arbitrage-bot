import "dotenv/config";

const USDC_DECIMALS = 6;

/** Minimum profit (after fees) as decimal, e.g. 0.001 = 0.1% */
export const MIN_PROFIT_BPS = 10; // 0.1% = 10 bps

/** Per-trade amount in USDC */
export const TRADE_AMOUNT_USDC = 0.001;

/** Max slippage in basis points (50 = 0.5%) */
export const MAX_SLIPPAGE_BPS = 50;

/** USDC amount in native units (0.5 USDC) */
export const TRADE_AMOUNT_RAW = BigInt(
  Math.floor(TRADE_AMOUNT_USDC * 10 ** USDC_DECIMALS)
);

export const JUPITER_API_BASE = "https://api.jup.ag/ultra/v1";
export const JUPITER_API_KEY = process.env.JUPITER_API_KEY ?? "";
export const PRIVATE_KEY_B58 = process.env.PRIVATE_KEY ?? "";
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;

/** PART1: 不要真正的交易 — 仅检测并打印套利机会，不提交链上交易 */
export const DRY_RUN = process.env.DRY_RUN === "1" || process.env.PART1 === "1";

/** 网络请求代理，默认 http://127.0.0.1:7890；设为空字符串表示不使用代理 */
export const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:7890";
/** 请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

/** Solana USDC mint */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Native SOL mint */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** Intermediate tokens to try for triangular arbitrage (USDC -> X -> USDC) */
export const INTERMEDIATE_MINTS = [
  SOL_MINT,
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
];

/** Mint -> 显示名称（用于日志） */
export const MINT_LABEL: Record<string, string> = {
  [SOL_MINT]: "SOL",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "BONK",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
};

export function getMinProfitRaw(): bigint {
  // 0.1% of trade amount, in USDC native units
  return (TRADE_AMOUNT_RAW * BigInt(MIN_PROFIT_BPS)) / BigInt(10_000);
}
