import type { Keypair } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import {
  getOrder,
  getQuote,
  getQuoteSwapV1,
  getSwapTransactionSwapV1,
  getSwapInstructionsSwapV1,
  buildMergedSwapTransaction,
  executeSwapV1,
  executeOrder,
} from "./jupiter.js";
import {
  USDC_MINT,
  CORNER_MINTS,
  getMinProfitRaw,
  MINT_LABEL,
  TRADE_AMOUNT_RAW,
  TRADE_AMOUNT_USDC,
  RPC_URL,
  STEP3_AMOUNT_BUFFER_BPS,
  STEP3_SLIPPAGE_BPS,
} from "./config.js";
import { proxyFetch } from "./proxyFetch.js";
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
  console.log(`    Step1 报价: ${TRADE_AMOUNT_USDC} USDC → ${order1.outAmount} ${l1} (raw)`);

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
    `     round-trip: 投入 ${TRADE_AMOUNT_USDC} USDC → 收回 ${formatUsdc(expectedUsdcBack)} USDC | 利润 ${formatUsdc(profitRaw)} USDC (${profitBps} bps)`
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

const SAME_MINT_ERROR = "Input and output mints are not allowed to be equal";

/**
 * Execute triangular arbitrage as a single atomic TX by merging 3 Swap API v1 legs.
 * Gets quote + swap-instructions for USDC→A, A→B, B→USDC and builds one transaction.
 */
async function runArbitrageSingleTxFromThreeQuotes(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ success: boolean; signature?: string; errorMessage?: string }> {
  const taker = wallet.publicKey.toBase58();

  console.log("  三角路径: 3 段报价 + 合并为单笔原子交易...");

  const quote1 = await getQuoteSwapV1({
    inputMint: USDC_MINT,
    outputMint: opp.corner1Mint,
    amount: TRADE_AMOUNT_RAW.toString(),
    taker,
    slippageBps: STEP3_SLIPPAGE_BPS,
  });
  if ("error" in quote1) {
    return { success: false, errorMessage: `Leg1 报价: ${(quote1 as { error: string }).error}` };
  }
  const amount2 = String((quote1 as { otherAmountThreshold?: string }).otherAmountThreshold ?? (quote1 as { outAmount?: string }).outAmount ?? opp.step1OutAmount);

  const quote2 = await getQuoteSwapV1({
    inputMint: opp.corner1Mint,
    outputMint: opp.corner2Mint,
    amount: amount2,
    taker,
    slippageBps: STEP3_SLIPPAGE_BPS,
  });
  if ("error" in quote2) {
    return { success: false, errorMessage: `Leg2 报价: ${(quote2 as { error: string }).error}` };
  }
  const amount3Raw = (quote2 as { otherAmountThreshold?: string }).otherAmountThreshold ?? (quote2 as { outAmount?: string }).outAmount ?? opp.step2OutAmount;
  const amount3 = String((BigInt(amount3Raw) * BigInt(STEP3_AMOUNT_BUFFER_BPS)) / BigInt(10_000));

  const quote3 = await getQuoteSwapV1({
    inputMint: opp.corner2Mint,
    outputMint: USDC_MINT,
    amount: amount3,
    taker,
    slippageBps: STEP3_SLIPPAGE_BPS,
  });
  if ("error" in quote3) {
    return { success: false, errorMessage: `Leg3 报价: ${(quote3 as { error: string }).error}` };
  }

  const inst1 = await getSwapInstructionsSwapV1({ quoteResponse: quote1, userPublicKey: taker });
  if ("error" in inst1) return { success: false, errorMessage: `Leg1 指令: ${inst1.error}` };
  const inst2 = await getSwapInstructionsSwapV1({ quoteResponse: quote2, userPublicKey: taker });
  if ("error" in inst2) return { success: false, errorMessage: `Leg2 指令: ${inst2.error}` };
  const inst3 = await getSwapInstructionsSwapV1({ quoteResponse: quote3, userPublicKey: taker });
  if ("error" in inst3) return { success: false, errorMessage: `Leg3 指令: ${inst3.error}` };

  const connection = new Connection(RPC_URL, { fetch: proxyFetch as any });
  const merged = await buildMergedSwapTransaction({
    instructionSets: [inst1, inst2, inst3],
    payer: wallet.publicKey,
    connection,
  });

  if (typeof merged !== "string") {
    return { success: false, errorMessage: merged.error };
  }

  console.log("  签名并提交 (单笔原子交易)...");
  const exec = await executeSwapV1(merged, wallet);
  if ("error" in exec) {
    return { success: false, errorMessage: exec.error };
  }
  return { success: true, signature: exec.signature };
}

/**
 * Fallback: execute triangular arbitrage using 3 separate Ultra API orders (non-atomic).
 */
async function runArbitrageThreeTx(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ success: boolean; signature?: string; errorMessage?: string }> {
  const taker = wallet.publicKey.toBase58();
  const l1 = mintLabel(opp.corner1Mint);
  const l2 = mintLabel(opp.corner2Mint);

  console.log("  [Fallback] 使用 3 笔独立交易 (Ultra API)...");

  try {
    // Step1: USDC -> corner1
    const order1 = await getOrder({
      inputMint: USDC_MINT,
      outputMint: opp.corner1Mint,
      amount: TRADE_AMOUNT_RAW,
      taker,
    });
    if ("error" in order1 || !order1.transaction) {
      const msg = "error" in order1 ? order1.error : "Step1 无 transaction";
      return { success: false, errorMessage: `Step1 报价失败: ${msg}` };
    }
    console.log(`  Step1: 提交 USDC → ${l1} ...`);
    const exec1 = await executeOrder(order1.requestId, order1.transaction, wallet);
    if (exec1.status !== "Success" || !exec1.signature) {
      return {
        success: false,
        errorMessage: `Step1 执行失败: ${exec1.error ?? "unknown error"}`,
      };
    }
    console.log(`  Step1 成功: ${exec1.signature}`);

    const step1Out = BigInt(order1.outAmount);

    // Step2: corner1 -> corner2
    const order2 = await getOrder({
      inputMint: opp.corner1Mint,
      outputMint: opp.corner2Mint,
      amount: step1Out,
      taker,
    });
    if ("error" in order2 || !order2.transaction) {
      const msg = "error" in order2 ? order2.error : "Step2 无 transaction";
      return { success: false, errorMessage: `Step2 报价失败: ${msg}` };
    }
    console.log(`  Step2: 提交 ${l1} → ${l2} ...`);
    const exec2 = await executeOrder(order2.requestId, order2.transaction, wallet);
    if (exec2.status !== "Success" || !exec2.signature) {
      return {
        success: false,
        errorMessage: `Step2 执行失败: ${exec2.error ?? "unknown error"}`,
      };
    }
    console.log(`  Step2 成功: ${exec2.signature}`);

    const step2Out = BigInt(order2.outAmount);

    // Step3: corner2 -> USDC
    const order3 = await getOrder({
      inputMint: opp.corner2Mint,
      outputMint: USDC_MINT,
      amount: step2Out,
      taker,
    });
    if ("error" in order3 || !order3.transaction) {
      const msg = "error" in order3 ? order3.error : "Step3 无 transaction";
      return { success: false, errorMessage: `Step3 报价失败: ${msg}` };
    }
    console.log(`  Step3: 提交 ${l2} → USDC ...`);
    const exec3 = await executeOrder(order3.requestId, order3.transaction, wallet);
    if (exec3.status !== "Success" || !exec3.signature) {
      return {
        success: false,
        errorMessage: `Step3 执行失败: ${exec3.error ?? "unknown error"}`,
      };
    }
    console.log(`  Step3 成功: ${exec3.signature}`);

    const combinedSig = `${exec1.signature} ${exec2.signature} ${exec3.signature}`;
    return { success: true, signature: combinedSig };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, errorMessage: msg };
  }
}

/**
 * Execute triangular arbitrage: USDC → A → B → USDC.
 * Prefers single atomic TX via Jupiter Swap API v1 (same-mint quote); if API
 * rejects ("Input and output mints are not allowed to be equal"), first tries
 * 3-leg atomic TX via Swap API v1 instructions, then falls back to 3 separate
 * TXs via Ultra API. Returns { success, signature } in both cases.
 */
export async function runArbitrage(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ success: boolean; signature?: string; errorMessage?: string }> {
  const taker = wallet.publicKey.toBase58();
  const l1 = mintLabel(opp.corner1Mint);
  const l2 = mintLabel(opp.corner2Mint);

  console.log("");
  console.log("========== 执行三角套利 ==========");
  console.log(
    `  路径: USDC → ${l1} → ${l2} → USDC | 预期利润 ${formatUsdc(
      opp.profitRaw
    )} USDC (${opp.profitBps} bps)`
  );

  console.log("  请求完整路径报价 (Swap API v1)...");
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
    if (err.includes(SAME_MINT_ERROR)) {
      console.log("  三角路径 (USDC→USDC) 不支持单笔报价，尝试 3 段报价合并为单笔原子交易");
      const atomicFromThree = await runArbitrageSingleTxFromThreeQuotes(wallet, opp);
      if (!atomicFromThree.success) {
        console.log(
          `  3 段原子交易失败: ${atomicFromThree.errorMessage ?? "unknown error"}，改用 3 笔独立交易 (Ultra API)`
        );
        return runArbitrageThreeTx(wallet, opp);
      }
      return atomicFromThree;
    }
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

  console.log("  签名并提交 (单笔原子交易)...");
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
