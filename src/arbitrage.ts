import type { Keypair } from "@solana/web3.js";
import { getOrder, getQuote, getQuoteSwapV1, getSwapTransactionSwapV1, executeSwapV1 } from "./jupiter.js";
import {
  USDC_MINT,
  CORNER_MINTS,
  getMinProfitRaw,
  MINT_LABEL,
  TRADE_AMOUNT_RAW,
  STEP3_SLIPPAGE_BPS,
} from "./config.js";
import type { JupiterOrderResponse } from "./types.js";

export interface ArbitrageOpportunity {
  corner1Mint: string;
  corner2Mint: string;
  step1OutAmount: string;
  step2OutAmount: string;
  expectedSolBack: bigint;
  profitRaw: bigint;
  profitBps: number;
  order1: JupiterOrderResponse;
  /** Step2/Step3 在执行前一步成功后再请求，扫描阶段仅用 quote 估算 */
  order2?: JupiterOrderResponse;
  order3?: JupiterOrderResponse;
}

function mintLabel(mint: string): string {
  return MINT_LABEL[mint] ?? `${mint.slice(0, 8)}…`;
}

export interface FindOpportunityResult {
  opportunity: ArbitrageOpportunity | null;
  scannedPaths: number;
}

const MAX_CONCURRENT_PATHS = 4;

/**
 * 单条路径扫描：USDC → c1 → c2 → USDC。不抛错，失败返回 null。
 */
async function scanOnePath(
  c1: string,
  c2: string,
  taker: string
): Promise<ArbitrageOpportunity | null> {
  const minProfitRaw = getMinProfitRaw();
  const l1 = mintLabel(c1);
  const l2 = mintLabel(c2);
  console.log(`  尝试路径: USDC → ${l1} → ${l2} → USDC`);

  const order1 = await getOrder({
    inputMint: USDC_MINT,
    outputMint: c1,
    amount: TRADE_AMOUNT_RAW,
    taker,
  });

  if ("error" in order1 || !order1.transaction || !order1.outAmount) {
    console.log(`    Step1 报价失败或无交易: ${"error" in order1 ? order1.error : "无 transaction"}`);
    return null;
  }

  const step1OutRaw = BigInt(order1.outAmount);
  console.log(`    Step1 报价: 1.99 USDC → ${order1.outAmount} ${l1} (raw)`);

  const quote2 = await getQuote({
    inputMint: c1,
    outputMint: c2,
    amount: step1OutRaw,
  });
  if ("error" in quote2) {
    console.log(`    Step2 报价失败: ${quote2.error}`);
    return null;
  }
  console.log(`    Step2 报价: ${order1.outAmount} ${l1} → ${quote2.otherAmountThreshold} ${l2} (最少)`);

  const quote3 = await getQuote({
    inputMint: c2,
    outputMint: USDC_MINT,
    amount: BigInt(quote2.outAmount),
  });
  if ("error" in quote3) {
    console.log(`    Step3 报价失败: ${quote3.error}`);
    return null;
  }

  const expectedUsdcBack = BigInt(quote3.otherAmountThreshold);
  const profitRaw =
    expectedUsdcBack > TRADE_AMOUNT_RAW
      ? expectedUsdcBack - TRADE_AMOUNT_RAW
      : BigInt(0);
  const profitBps = Number(
    (profitRaw * BigInt(10_000)) / TRADE_AMOUNT_RAW
  );

  console.log(
    `    Step3 报价: ${quote2.outAmount} ${l2} → ${formatUsdc(expectedUsdcBack)} USDC (最少)`
  );
  console.log(
    `     round-trip: 投入 1.99 USDC → 收回 ${formatUsdc(expectedUsdcBack)} USDC | 利润 ${formatUsdc(profitRaw)} USDC (${profitBps} bps)`
  );

  if (profitRaw < minProfitRaw) {
    console.log(`    未达最低利润阈值 (0.1%)，跳过`);
    return null;
  }

  console.log(`    ✓ 发现套利机会`);
  return {
    corner1Mint: c1,
    corner2Mint: c2,
    step1OutAmount: order1.outAmount,
    step2OutAmount: quote2.outAmount,
    expectedSolBack: expectedUsdcBack,
    profitRaw,
    profitBps,
    order1: order1 as JupiterOrderResponse,
    order2: undefined,
    order3: undefined,
  };
}

/**
 * 三角套利 USDC -> corner1 -> corner2 -> USDC，检查是否满足最低利润 (0.1%)。
 * 并行扫描，最多 4 个并发。遇网络错误不抛错，仍返回已扫描路径数。
 */
export async function findOpportunity(
  taker: string
): Promise<FindOpportunityResult> {
  const pairs: { c1: string; c2: string }[] = [];
  for (const c1 of CORNER_MINTS) {
    for (const c2 of CORNER_MINTS) {
      if (c1 !== c2) pairs.push({ c1, c2 });
    }
  }

  let nextIdx = 0;
  let scannedPaths = 0;
  let found: ArbitrageOpportunity | null = null;

  const runWorker = async (): Promise<void> => {
    while (found === null) {
      const idx = nextIdx++;
      if (idx >= pairs.length) return;
      scannedPaths++;
      const pair = pairs[idx];
      try {
        const opp = await scanOnePath(pair.c1, pair.c2, taker);
        if (opp) found = opp;
      } catch (err) {
        console.error(`    路径 USDC → ${mintLabel(pair.c1)} → ${mintLabel(pair.c2)} → USDC 异常:`, err);
      }
    }
  };

  const concurrency = Math.min(MAX_CONCURRENT_PATHS, pairs.length);
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  return {
    opportunity: found,
    scannedPaths,
  };
}

/**
 * Execute triangular arbitrage as a single atomic TX: USDC → A → B → USDC.
 * Uses Jupiter Swap API v1 multi-hop: one quote for full path, one swap TX.
 */
export async function runArbitrage(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ success: boolean; signature?: string; errorMessage?: string }> {
  const taker = wallet.publicKey.toBase58();
  const l1 = mintLabel(opp.corner1Mint);
  const l2 = mintLabel(opp.corner2Mint);

  console.log("");
  console.log("========== 执行三角套利（单笔原子交易） ==========");
  console.log(
    `  路径: USDC → ${l1} → ${l2} → USDC | 预期利润 ${formatUsdc(
      opp.profitRaw
    )} USDC (${opp.profitBps} bps)`
  );

  console.log("  请求完整路径报价 (USDC → USDC, restrictIntermediateTokens=false)...");
  const quote = await getQuoteSwapV1({
    inputMint: USDC_MINT,
    outputMint: USDC_MINT,
    amount: TRADE_AMOUNT_RAW.toString(),
    taker,
    slippageBps: STEP3_SLIPPAGE_BPS,
    restrictIntermediateTokens: false,
  });

  if ("error" in quote) {
    const err = (quote as { error: string }).error;
    console.error("  报价失败:", err);
    return { success: false, errorMessage: err };
  }

  console.log("  生成单笔交易...");
  const swapResult = await getSwapTransactionSwapV1({
    quoteResponse: quote,
    userPublicKey: taker,
  });

  if ("error" in swapResult) {
    console.error("  生成交易失败:", swapResult.error);
    return { success: false, errorMessage: swapResult.error };
  }

  console.log("  签名并提交...");
  const exec = await executeSwapV1(swapResult.swapTransaction, wallet);

  if ("error" in exec) {
    console.error("  提交失败:", exec.error);
    return { success: false, errorMessage: exec.error };
  }

  console.log("  成功:", exec.signature);
  console.log("========== 三角套利完成 ==========");
  console.log("");
  return { success: true, signature: exec.signature };
}

export function formatUsdc(raw: bigint): string {
  return (Number(raw) / 1e6).toFixed(6);
}

export function logOpportunity(opp: ArbitrageOpportunity): void {
  const l1 = mintLabel(opp.corner1Mint);
  const l2 = mintLabel(opp.corner2Mint);
  console.log("");
  console.log(
    `[套利机会] USDC → ${l1} → ${l2} → USDC | ` +
      `预期收回 ${formatUsdc(opp.expectedSolBack)} USDC | ` +
      `利润 ${formatUsdc(opp.profitRaw)} USDC (${opp.profitBps} bps)`
  );
}
