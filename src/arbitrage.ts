import type { Keypair } from "@solana/web3.js";
import { getOrder, getQuote, executeOrder } from "./jupiter.js";
import {
  SOL_MINT,
  INTERMEDIATE_MINTS,
  getMinProfitRaw,
  MINT_LABEL,
  TRADE_AMOUNT_SOL,
  TRADE_AMOUNT_RAW,
} from "./config.js";
import type { JupiterOrderResponse } from "./types.js";

export interface ArbitrageOpportunity {
  intermediateMint: string;
  step1OutAmount: string;
  step2OutAmount: string;
  expectedSolBack: bigint;
  profitRaw: bigint;
  profitBps: number;
  order1: JupiterOrderResponse;
  /** Step2 订单在 Step1 执行成功后才会请求（此时钱包已有中间币），扫描阶段仅用 quote 估算 */
  order2?: JupiterOrderResponse;
}

function midLabel(mint: string): string {
  return MINT_LABEL[mint] ?? `${mint.slice(0, 8)}…`;
}

/**
 * 三角套利 SOL -> 中间 -> SOL，检查是否满足最低利润 (0.1%)。
 */
export async function findOpportunity(
  taker: string
): Promise<ArbitrageOpportunity | null> {
  const minProfitRaw = getMinProfitRaw();

  for (const midMint of INTERMEDIATE_MINTS) {
    const label = midLabel(midMint);
    console.log(`  尝试路径: SOL → ${label} → SOL`);

    const order1 = await getOrder({
      inputMint: SOL_MINT,
      outputMint: midMint,
      amount: TRADE_AMOUNT_RAW,
      taker,
    });

    if ("error" in order1 || !order1.transaction || !order1.outAmount) {
      console.log(`    Step1 报价失败或无交易: ${"error" in order1 ? order1.error : "无 transaction"}`);
      continue;
    }

    const step1OutRaw = BigInt(order1.outAmount);
    console.log(`    Step1 报价: ${TRADE_AMOUNT_SOL} SOL → ${order1.outAmount} ${label} (raw)`);

    // 使用 Quote API 估算 Step2，不校验钱包余额（扫描时钱包尚无中间币，用 /order 会报 Insufficient funds）
    const quote2 = await getQuote({
      inputMint: midMint,
      outputMint: SOL_MINT,
      amount: step1OutRaw,
    });

    if ("error" in quote2) {
      console.log(`    Step2 报价失败: ${quote2.error}`);
      continue;
    }

    const expectedSolBack = BigInt(quote2.otherAmountThreshold);
    const profitRaw = expectedSolBack > TRADE_AMOUNT_RAW
      ? expectedSolBack - TRADE_AMOUNT_RAW
      : BigInt(0);
    const profitBps = Number(
      (profitRaw * BigInt(10_000)) / TRADE_AMOUNT_RAW
    );

    console.log(`    Step2 报价: ${order1.outAmount} ${label} → ${formatSol(expectedSolBack)} SOL (最少)`);
    console.log(`     round-trip 结果: 投入 ${TRADE_AMOUNT_SOL} SOL → 收回 ${formatSol(expectedSolBack)} SOL | 利润 ${formatSol(profitRaw)} SOL (${profitBps} bps)`);

    if (profitRaw < minProfitRaw) {
      console.log(`    未达最低利润阈值 (0.1%)，跳过`);
      continue;
    }

    console.log(`    ✓ 发现套利机会`);
    return {
      intermediateMint: midMint,
      step1OutAmount: order1.outAmount,
      step2OutAmount: quote2.outAmount,
      expectedSolBack,
      profitRaw,
      profitBps,
      order1: order1 as JupiterOrderResponse,
      order2: undefined,
    };
  }

  return null;
}

/**
 * Execute a two-step arbitrage: sign and submit both swaps in sequence.
 * Step2 订单在 Step1 成功后再请求（此时钱包已持有中间币），避免 Jupiter 报 Insufficient funds。
 */
export async function runArbitrage(
  wallet: Keypair,
  opp: ArbitrageOpportunity
): Promise<{ step1: boolean; step2: boolean; signature1?: string; signature2?: string }> {
  if (!opp.order1.transaction) {
    return { step1: false, step2: false };
  }

  const taker = wallet.publicKey.toBase58();
  const mid = midLabel(opp.intermediateMint);
  console.log("");
  console.log("========== 执行套利 ==========");
  console.log(`  路径: SOL → ${mid} → SOL | 预期利润 ${formatSol(opp.profitRaw)} SOL (${opp.profitBps} bps)`);
  console.log("  Step1: 提交 SOL → " + mid + " ...");
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

  let order2 = opp.order2;
  if (!order2?.transaction) {
    console.log("  Step2: 请求订单（钱包已持有 " + mid + "）...");
    const step2Order = await getOrder({
      inputMint: opp.intermediateMint,
      outputMint: SOL_MINT,
      amount: BigInt(opp.step1OutAmount),
      taker,
    });
    if ("error" in step2Order || !step2Order.transaction) {
      console.error("  Step2 订单请求失败:", "error" in step2Order ? step2Order.error : "无 transaction");
      return { step1: true, step2: false, signature1: exec1.signature };
    }
    order2 = step2Order;
  }

  if (!order2.transaction) {
    console.error("  Step2 无有效 transaction");
    return { step1: true, step2: false, signature1: exec1.signature };
  }
  console.log("  Step2: 提交 " + mid + " → SOL ...");
  const exec2 = await executeOrder(
    order2.requestId,
    order2.transaction,
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

export function formatSol(raw: bigint): string {
  return (Number(raw) / 1e9).toFixed(9);
}

export function logOpportunity(opp: ArbitrageOpportunity): void {
  const mid = midLabel(opp.intermediateMint);
  console.log("");
  console.log(
    `[套利机会] SOL → ${mid} → SOL | ` +
      `预期收回 ${formatSol(opp.expectedSolBack)} SOL | ` +
      `利润 ${formatSol(opp.profitRaw)} SOL (${opp.profitBps} bps)`
  );
}
