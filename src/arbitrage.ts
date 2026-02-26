import type { Keypair } from "@solana/web3.js";
import { getOrder, getQuote, executeOrder } from "./jupiter.js";
import {
  USDC_MINT,
  CORNER_MINTS,
  getMinProfitRaw,
  MINT_LABEL,
  TRADE_AMOUNT_RAW,
  STEP3_AMOUNT_BUFFER_BPS,
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
 * Execute triangular arbitrage: USDC → corner1 → corner2 → USDC (3 swaps).
 * Step1 在执行前重新要价，避免使用扫描阶段的陈旧订单导致 "Slippage tolerance exceeded"。
 * Step2/Step3 在前一步成功后再请求，避免 Jupiter 报 Insufficient funds。
 */
export async function runArbitrage(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ step1: boolean; step2: boolean; step3: boolean; signature1?: string; signature2?: string; signature3?: string; errorMessage?: string }> {
  const taker = wallet.publicKey.toBase58();
  const l1 = mintLabel(opp.corner1Mint);
  const l2 = mintLabel(opp.corner2Mint);
  const fail = (step: string, detail: string) => `${step}: ${detail}`;

  console.log("");
  console.log("========== 执行三角套利 ==========");
  console.log(
    `  路径: USDC → ${l1} → ${l2} → USDC | 预期利润 ${formatUsdc(
      opp.profitRaw
    )} USDC (${opp.profitBps} bps)`
  );

  // Step1 执行前重新要价，避免扫描阶段报价过期导致链上滑点失败
  console.log("  Step1: 请求订单（USDC → " + l1 + "）...");
  const order1Fresh = await getOrder({
    inputMint: USDC_MINT,
    outputMint: opp.corner1Mint,
    amount: TRADE_AMOUNT_RAW,
    taker,
  });
  if ("error" in order1Fresh || !order1Fresh.transaction) {
    const msg = "error" in order1Fresh ? order1Fresh.error : "无 transaction";
    console.error("  Step1 订单请求失败:", msg);
    return { step1: false, step2: false, step3: false, errorMessage: fail("Step1订单请求失败", msg) };
  }
  console.log("  Step1: 提交 USDC → " + l1 + " ...");
  const exec1 = await executeOrder(
    order1Fresh.requestId,
    order1Fresh.transaction,
    wallet
  );

  if (exec1.status !== "Success" || !exec1.signature) {
    const msg = exec1.error ?? String(exec1);
    console.error("  Step1 失败:", msg);
    return { step1: false, step2: false, step3: false, errorMessage: fail("Step1执行失败", msg) };
  }
  console.log("  Step1 成功:", exec1.signature);

  let order2 = opp.order2;
  if (!order2?.transaction) {
    console.log("  Step2: 请求订单（钱包已持有 " + l1 + "）...");
    const step2Order = await getOrder({
      inputMint: opp.corner1Mint,
      outputMint: opp.corner2Mint,
      // 使用本次执行 Step1 订单的最小输出量，避免实际到账略小于预估导致 Insufficient funds
      amount: BigInt(order1Fresh.otherAmountThreshold ?? order1Fresh.outAmount),
      taker,
    });
    if ("error" in step2Order || !step2Order.transaction) {
      const msg = "error" in step2Order ? step2Order.error : "无 transaction";
      console.error("  Step2 订单请求失败:", msg);
      return { step1: true, step2: false, step3: false, signature1: exec1.signature, errorMessage: fail("Step2订单请求失败", msg) };
    }
    order2 = step2Order;
  }

  if (!order2.transaction) {
    console.error("  Step2 无有效 transaction");
    return { step1: true, step2: false, step3: false, signature1: exec1.signature, errorMessage: fail("Step2", "无有效 transaction") };
  }
  console.log("  Step2: 提交 " + l1 + " → " + l2 + " ...");
  const exec2 = await executeOrder(
    order2.requestId,
    order2.transaction,
    wallet
  );

  if (exec2.status !== "Success" || !exec2.signature) {
    const msg = exec2.error ?? String(exec2);
    console.error("  Step2 失败:", msg);
    return { step1: true, step2: false, step3: false, signature1: exec1.signature, errorMessage: fail("Step2执行失败", msg) };
  }
  console.log("  Step2 成功:", exec2.signature);

  // Step3: corner2 → USDC
  // 用 Step2 的（最小）输出量请求；若用「报价量」请求，Step2 实际到账可能略少（其自身滑点），
  // 导致 Step3 实际换得的 USDC 低于订单里的最低保护 → "Slippage tolerance exceeded"。
  // 故对 Step3 的 input 打一个折扣（STEP3_AMOUNT_BUFFER），按略少数量要价，更容易满足链上最低输出。
  const step2OutRaw =
    order2.otherAmountThreshold ?? order2.outAmount ?? opp.step2OutAmount;
  const step3AmountRaw = (BigInt(step2OutRaw) * BigInt(STEP3_AMOUNT_BUFFER_BPS)) / BigInt(10_000);
  console.log("  Step3: 请求订单（" + l2 + " → USDC）...");
  const step3Order = await getOrder({
    inputMint: opp.corner2Mint,
    outputMint: USDC_MINT,
    amount: step3AmountRaw,
    taker,
    slippageBps: STEP3_SLIPPAGE_BPS,
  });
  if ("error" in step3Order || !step3Order.transaction) {
    const msg = "error" in step3Order ? step3Order.error : "无 transaction";
    console.error("  Step3 订单请求失败:", msg);
    return { step1: true, step2: true, step3: false, signature1: exec1.signature, signature2: exec2.signature, errorMessage: fail("Step3订单请求失败", msg) };
  }
  console.log("  Step3: 提交 " + l2 + " → USDC ...");
  const exec3 = await executeOrder(
    step3Order.requestId,
    step3Order.transaction,
    wallet
  );

  if (exec3.status !== "Success") {
    const msg = exec3.error ?? String(exec3);
    console.error("  Step3 失败:", msg);
    return { step1: true, step2: true, step3: false, signature1: exec1.signature, signature2: exec2.signature, errorMessage: fail("Step3执行失败", msg) };
  }
  console.log("  Step3 成功:", exec3.signature);
  console.log("========== 三角套利完成 ==========");
  console.log("");
  return {
    step1: true,
    step2: true,
    step3: true,
    signature1: exec1.signature,
    signature2: exec2.signature,
    signature3: exec3.signature,
  };
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
