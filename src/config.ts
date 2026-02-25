import "dotenv/config";

/** Minimum profit (after fees) in bps, e.g. 10 = 0.1% */
export const MIN_PROFIT_BPS = 10; // 0.1%

/** USDC decimals on Solana */
const USDC_DECIMALS = 6;

/**
 * 每笔套利金额（USDC）。
 * 按 PART4 要求，默认 1.99 USDC，可通过 TRADE_AMOUNT_USDC 覆盖。
 */
export const TRADE_AMOUNT_USDC =
  Number(process.env.TRADE_AMOUNT_USDC) || 1.99;

/** 每笔套利金额，按 USDC 最小单位（10^6）表示 */
export const TRADE_AMOUNT_RAW = BigInt(
  Math.floor(TRADE_AMOUNT_USDC * 10 ** USDC_DECIMALS)
);

/**
 * Max slippage in basis points.
 * 三角路径共有 3 笔 swap，为了在最坏滑点下仍保留 ≥0.1% 利润，
 * 近似要求 3 * MAX_SLIPPAGE_BPS < MIN_PROFIT_BPS (=10 bps)，因此默认设为 3 bps。
 */
export const MAX_SLIPPAGE_BPS = Number(process.env.MAX_SLIPPAGE_BPS) || 3;

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

/** 预检查：要求钱包至少保留的 SOL（lamports），用于 gas；三角套利 3 笔交易，约 0.008 SOL */
export const MIN_SOL_LAMPORTS = Number(process.env.MIN_SOL_LAMPORTS) || 8_000_000;

/** Solana USDC mint */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Native SOL / WSOL mint (wrapped SOL 同地址) */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
/** USDT mint */
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
/** USD1 (World Liberty Financial) mint */
export const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";
/** LIT mint */
export const LIT_MINT = "EicWvteVi2fWepEzS3FYWsnuPoP6caZfjnKqNvydLjCH";

/**
 * 三角套利 USDC -> corner1 -> corner2 -> USDC 的角代币集合（不含 USDC 本身）。
 * 按 PART4 要求重置为: USD1, WSOL, USDT, LIT。
 */
export const CORNER_MINTS = [
  USD1_MINT,
  SOL_MINT,
  USDT_MINT,
  LIT_MINT,
];

/** Mint -> 显示名称（用于日志） */
export const MINT_LABEL: Record<string, string> = {
  [SOL_MINT]: "SOL",
  [USDC_MINT]: "USDC",
  [USDT_MINT]: "USDT",
  [USD1_MINT]: "USD1",
  [LIT_MINT]: "LIT",
};

export function getMinProfitRaw(): bigint {
  // 0.1% of trade amount, in USDC smallest units
  return (TRADE_AMOUNT_RAW * BigInt(MIN_PROFIT_BPS)) / BigInt(10_000);
}
