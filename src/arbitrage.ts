import type { Keypair } from "@solana/web3.js";
import { getOrder, getQuote, executeOrder } from "./jupiter.js";
import {
  USDC_MINT,
  CORNER_MINTS,
  getMinProfitRaw,
  MINT_LABEL,
  TRADE_AMOUNT_RAW,
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

/**
 * 三角套利 USDC -> corner1 -> corner2 -> USDC，检查是否满足最低利润 (0.1%)。
 */
export async function findOpportunity(
  taker: string
): Promise<FindOpportunityResult> {
  const minProfitRaw = getMinProfitRaw();
  let scannedPaths = 0;

  for (const c1 of CORNER_MINTS) {
    for (const c2 of CORNER_MINTS) {
      if (c1 === c2) continue;
      scannedPaths++;
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
        continue;
      }

      const step1OutRaw = BigInt(order1.outAmount);
      console.log(
        `    Step1 报价: 1.99 USDC → ${order1.outAmount} ${l1} (raw)`
      );

      const quote2 = await getQuote({
        inputMint: c1,
        outputMint: c2,
        amount: step1OutRaw,
      });
      if ("error" in quote2) {
        console.log(`    Step2 报价失败: ${quote2.error}`);
        continue;
      }
      console.log(`    Step2 报价: ${order1.outAmount} ${l1} → ${quote2.otherAmountThreshold} ${l2} (最少)`);

      const quote3 = await getQuote({
        inputMint: c2,
        outputMint: USDC_MINT,
        amount: BigInt(quote2.outAmount),
      });
      if ("error" in quote3) {
        console.log(`    Step3 报价失败: ${quote3.error}`);
        continue;
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
        `    Step3 报价: ${quote2.outAmount} ${l2} → ${formatUsdc(
          expectedUsdcBack
        )} USDC (最少)`
      );
      console.log(
        `     round-trip: 投入 1.99 USDC → 收回 ${formatUsdc(
          expectedUsdcBack
        )} USDC | 利润 ${formatUsdc(profitRaw)} USDC (${profitBps} bps)`
      );

      if (profitRaw < minProfitRaw) {
        console.log(`    未达最低利润阈值 (0.1%)，跳过`);
        continue;
      }

      console.log(`    ✓ 发现套利机会`);
      return {
        opportunity: {
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
        },
        scannedPaths,
      };
    }
  }

  return { opportunity: null, scannedPaths };
}

/**
 * Execute triangular arbitrage: USDC → corner1 → corner2 → USDC (3 swaps).
 * Step2/Step3 订单在前一步成功后再请求，避免 Jupiter 报 Insufficient funds。
 */
export async function runArbitrage(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ step1: boolean; step2: boolean; step3: boolean; signature1?: string; signature2?: string; signature3?: string }> {
  if (!opp.order1.transaction) {
    return { step1: false, step2: false, step3: false };
  }

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
  console.log("  Step1: 提交 USDC → " + l1 + " ...");
  const exec1 = await executeOrder(
    opp.order1.requestId,
    opp.order1.transaction,
    wallet
  );

  if (exec1.status !== "Success" || !exec1.signature) {
    console.error("  Step1 失败:", exec1.error ?? exec1);
    return { step1: false, step2: false, step3: false };
  }
  console.log("  Step1 成功:", exec1.signature);

  let order2 = opp.order2;
  if (!order2?.transaction) {
    console.log("  Step2: 请求订单（钱包已持有 " + l1 + "）...");
    const step2Order = await getOrder({
      inputMint: opp.corner1Mint,
      outputMint: opp.corner2Mint,
      // 使用 Step1 订单中保证的最小输出量，避免由于实际到账略小于预估 outAmount 导致 Insufficient funds
      amount: BigInt(opp.order1.otherAmountThreshold ?? opp.step1OutAmount),
      taker,
    });
    if ("error" in step2Order || !step2Order.transaction) {
      console.error("  Step2 订单请求失败:", "error" in step2Order ? step2Order.error : "无 transaction");
      return { step1: true, step2: false, step3: false, signature1: exec1.signature };
    }
    order2 = step2Order;
  }

  if (!order2.transaction) {
    console.error("  Step2 无有效 transaction");
    return { step1: true, step2: false, step3: false, signature1: exec1.signature };
  }
  console.log("  Step2: 提交 " + l1 + " → " + l2 + " ...");
  const exec2 = await executeOrder(
    order2.requestId,
    order2.transaction,
    wallet
  );

  if (exec2.status !== "Success" || !exec2.signature) {
    console.error("  Step2 失败:", exec2.error ?? exec2);
    return { step1: true, step2: false, step3: false, signature1: exec1.signature };
  }
  console.log("  Step2 成功:", exec2.signature);

  // Step3: corner2 → USDC（需用 Step2 实际输出量请求，此处用扫描时的 step2OutAmount 近似）
  // 优先使用 Step2 订单的最小保证输出量，其次是预估 outAmount，最后退回扫描阶段的估算值
  const step2OutForOrder =
    order2.otherAmountThreshold ?? order2.outAmount ?? opp.step2OutAmount;
  console.log("  Step3: 请求订单（" + l2 + " → USDC）...");
  const step3Order = await getOrder({
    inputMint: opp.corner2Mint,
    outputMint: USDC_MINT,
    amount: BigInt(step2OutForOrder),
    taker,
  });
  if ("error" in step3Order || !step3Order.transaction) {
    console.error("  Step3 订单请求失败:", "error" in step3Order ? step3Order.error : "无 transaction");
    return { step1: true, step2: true, step3: false, signature1: exec1.signature, signature2: exec2.signature };
  }
  console.log("  Step3: 提交 " + l2 + " → USDC ...");
  const exec3 = await executeOrder(
    step3Order.requestId,
    step3Order.transaction,
    wallet
  );

  if (exec3.status !== "Success") {
    console.error("  Step3 失败:", exec3.error ?? exec3);
    return { step1: true, step2: true, step3: false, signature1: exec1.signature, signature2: exec2.signature };
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
