import type { Keypair } from "@solana/web3.js";
import {
  getOrder,
  executeOrder,
  getWallet,
  TRADE_AMOUNT_RAW,
} from "./jupiter.js";
import {
  USDC_MINT,
  INTERMEDIATE_MINTS,
  getMinProfitRaw,
  MINT_LABEL,
  TRADE_AMOUNT_USDC,
} from "./config.js";
import type { JupiterOrderResponse } from "./types.js";

const USDC_DECIMALS = 6;

export interface ArbitrageOpportunity {
  intermediateMint: string;
  step1OutAmount: string;
  step2OutAmount: string;
  expectedUsdcBack: bigint;
  profitRaw: bigint;
  profitBps: number;
  order1: JupiterOrderResponse;
  order2: JupiterOrderResponse;
}

function midLabel(mint: string): string {
  return MINT_LABEL[mint] ?? `${mint.slice(0, 8)}…`;
}

/**
 * Check if a round-trip USDC -> intermediate -> USDC is profitable (>= 0.1% after fees).
 */
export async function findOpportunity(
  taker: string
): Promise<ArbitrageOpportunity | null> {
  const minProfitRaw = getMinProfitRaw();

  for (const midMint of INTERMEDIATE_MINTS) {
    const label = midLabel(midMint);
    console.log(`  尝试路径: USDC → ${label} → USDC`);

    const order1 = await getOrder({
      inputMint: USDC_MINT,
      outputMint: midMint,
      amount: TRADE_AMOUNT_RAW,
      taker,
    });

    if ("error" in order1 || !order1.transaction || !order1.outAmount) {
      console.log(`    Step1 报价失败或无交易: ${"error" in order1 ? order1.error : "无 transaction"}`);
      continue;
    }

    const step1OutRaw = BigInt(order1.outAmount);
    console.log(`    Step1 报价: ${TRADE_AMOUNT_USDC} USDC → ${order1.outAmount} ${label} (raw)`);

    const order2 = await getOrder({
      inputMint: midMint,
      outputMint: USDC_MINT,
      amount: step1OutRaw,
      taker,
    });

    if ("error" in order2 || !order2.transaction || !order2.outAmount) {
      console.log(`    Step2 报价失败或无交易: ${"error" in order2 ? order2.error : "无 transaction"}`);
      continue;
    }

    const expectedUsdcBack = BigInt(order2.otherAmountThreshold);
    const profitRaw = expectedUsdcBack > TRADE_AMOUNT_RAW
      ? expectedUsdcBack - TRADE_AMOUNT_RAW
      : BigInt(0);
    const profitBps = Number(
      (profitRaw * BigInt(10_000)) / TRADE_AMOUNT_RAW
    );

    console.log(`    Step2 报价: ${order1.outAmount} ${label} → ${formatUsdc(expectedUsdcBack)} USDC (最少)`);
    console.log(`     round-trip 结果: 投入 ${TRADE_AMOUNT_USDC} USDC → 收回 ${formatUsdc(expectedUsdcBack)} USDC | 利润 ${formatUsdc(profitRaw)} USDC (${profitBps} bps)`);

    if (profitRaw < minProfitRaw) {
      console.log(`    未达最低利润阈值 (0.1%)，跳过`);
      continue;
    }

    console.log(`    ✓ 发现套利机会`);
    return {
      intermediateMint: midMint,
      step1OutAmount: order1.outAmount,
      step2OutAmount: order2.outAmount,
      expectedUsdcBack,
      profitRaw,
      profitBps,
      order1: order1 as JupiterOrderResponse,
      order2: order2 as JupiterOrderResponse,
    };
  }

  return null;
}

/**
 * Execute a two-step arbitrage: sign and submit both swaps in sequence.
 */
export async function runArbitrage(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ step1: boolean; step2: boolean; signature1?: string; signature2?: string }> {
  if (!opp.order1.transaction || !opp.order2.transaction) {
    return { step1: false, step2: false };
  }

  const mid = midLabel(opp.intermediateMint);
  console.log("");
  console.log("========== 执行套利 ==========");
  console.log(`  路径: USDC → ${mid} → USDC | 预期利润 ${formatUsdc(opp.profitRaw)} USDC (${opp.profitBps} bps)`);
  console.log("  Step1: 提交 USDC → " + mid + " ...");
  const exec1 = await executeOrder(
    opp.order1.requestId,
    opp.order1.transaction,
    wallet
  );

  if (exec1.status !== "Success" || !exec1.signature) {
    console.error("  Step1 失败:", exec1.error ?? exec1);
    return { step1: false, step2: false };
  }
  console.log("  Step1 成功:", exec1.signature);

  console.log("  Step2: 提交 " + mid + " → USDC ...");
  const exec2 = await executeOrder(
    opp.order2.requestId,
    opp.order2.transaction,
    wallet
  );

  if (exec2.status !== "Success") {
    console.error("  Step2 失败:", exec2.error ?? exec2);
    return { step1: true, step2: false, signature1: exec1.signature };
  }
  console.log("  Step2 成功:", exec2.signature);
  console.log("========== 套利完成 ==========");
  console.log("");
  return {
    step1: true,
    step2: true,
    signature1: exec1.signature,
    signature2: exec2.signature,
  };
}

export function formatUsdc(raw: bigint): string {
  return (Number(raw) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS);
}

export function logOpportunity(opp: ArbitrageOpportunity): void {
  const mid = midLabel(opp.intermediateMint);
  console.log("");
  console.log(
    `[套利机会] USDC → ${mid} → USDC | ` +
      `预期收回 ${formatUsdc(opp.expectedUsdcBack)} USDC | ` +
      `利润 ${formatUsdc(opp.profitRaw)} USDC (${opp.profitBps} bps)`
  );
}
