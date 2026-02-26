import { getWallet } from "./jupiter.js";
import {
  POLL_INTERVAL_MS,
  DRY_RUN,
  TRADE_AMOUNT_USDC,
  TRADE_AMOUNT_RAW,
  MIN_PROFIT_BPS,
  MINT_LABEL,
} from "./config.js";
import {
  findOpportunity,
  runArbitrage,
  logOpportunity,
  formatUsdc,
} from "./arbitrage.js";
import { checkWalletBalance, formatSol, formatUsdcBalance } from "./balance.js";
import {
  isDbEnabled,
  insertScan,
  updateScan,
  insertOpportunity,
  updateOpportunityStatus,
  insertExecution,
  updateExecution,
  insertTx,
} from "./db.js";

function buildPath(corner1Mint: string, corner2Mint: string): string {
  const l1 = MINT_LABEL[corner1Mint] ?? corner1Mint.slice(0, 8);
  const l2 = MINT_LABEL[corner2Mint] ?? corner2Mint.slice(0, 8);
  return `USDC->${l1}->${l2}->USDC`;
}

/** 按代币精度格式化数量：SOL 9 位，其余 6 位 */
function amountByToken(tokenLabel: string, rawAmount: string): string {
  const n = Number(rawAmount);
  return tokenLabel === "SOL" ? (n / 1e9).toFixed(9) : (n / 1e6).toFixed(6);
}

async function main(): Promise<void> {
  const wallet = getWallet();
  const taker = wallet.publicKey.toBase58();
  console.log("Arbitrage bot started. Wallet:", taker);
  console.log("Poll interval:", POLL_INTERVAL_MS, "ms");
  console.log("DRY_RUN (不真实交易):", DRY_RUN);
  console.log(
    "每笔套利金额:",
    TRADE_AMOUNT_USDC,
    "USDC (raw:",
    TRADE_AMOUNT_RAW.toString() + ")"
  );
  if (isDbEnabled()) {
    console.log("DB: 已启用，套利记录将写入数据库");
  }
  console.log("---");

  for (;;) {
    try {
      const balance = await checkWalletBalance(wallet.publicKey);
      const walletSolBalance = balance.solLamports / 1e9;
      const walletUsdcBalance = balance.usdcRaw / 1e6;
      console.log("\n[预检查] 钱包余额: SOL", formatSol(balance.solLamports), "| USDC", formatUsdcBalance(balance.usdcRaw));
      if (!balance.ok) {
        console.log("[预检查] 跳过本轮:", balance.message);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      const scanStartTime = new Date();
      let scanId: number | null = null;
      if (isDbEnabled()) {
        try {
          scanId = await insertScan(taker, walletSolBalance, walletUsdcBalance);
        } catch (e) {
          console.error("[DB] insertScan failed:", e);
        }
      }

      console.log("[扫描] 正在检测套利机会...");
      const { opportunity: opp, scannedPaths } = await findOpportunity(taker);
      const scanEndTime = new Date();

      if (isDbEnabled() && scanId !== null) {
        try {
          await updateScan(
            scanId,
            scanEndTime,
            scannedPaths,
            opp ? 1 : 0
          );
        } catch (e) {
          console.error("[DB] updateScan failed:", e);
        }
      }

      if (opp) {
        logOpportunity(opp);
        const path = buildPath(opp.corner1Mint, opp.corner2Mint);
        const l1 = MINT_LABEL[opp.corner1Mint] ?? "?";
        const l2 = MINT_LABEL[opp.corner2Mint] ?? "?";

        let opportunityId: number | null = null;
        if (isDbEnabled() && scanId !== null) {
          try {
            opportunityId = await insertOpportunity(
              scanId,
              path,
              "USDC",
              TRADE_AMOUNT_USDC.toString(),
              formatUsdc(opp.expectedSolBack),
              formatUsdc(opp.profitRaw),
              opp.profitBps,
              MIN_PROFIT_BPS,
              "SKIPPED"
            );
          } catch (e) {
            console.error("[DB] insertOpportunity failed:", e);
          }
        }

        if (DRY_RUN) {
          console.log("[DRY_RUN] 仅检测，未提交交易");
          console.log("");
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }

        let executionId: number | null = null;
        if (isDbEnabled() && opportunityId !== null) {
          try {
            executionId = await insertExecution(opportunityId, new Date());
          } catch (e) {
            console.error("[DB] insertExecution failed:", e);
          }
        }

        const result = await runArbitrage(wallet, opp);
        const executionEnd = new Date();
        const success = result.step1 && result.step2 && result.step3;

        if (isDbEnabled() && executionId !== null) {
          try {
            await updateExecution(executionId, executionEnd, success ? "SUCCESS" : "FAILED", {
              errorMessage: success ? null : (result.step1 === false ? "Step1 failed" : result.step2 === false ? "Step2 failed" : "Step3 failed"),
            });
            const step1Input = TRADE_AMOUNT_USDC.toString();
            const step1Output = amountByToken(l1, opp.step1OutAmount);
            const step2Input = step1Output;
            const step2Output = amountByToken(l2, opp.step2OutAmount);
            const step3Input = step2Output;
            const step3Output = formatUsdc(opp.expectedSolBack);
            await insertTx(
              executionId,
              1,
              "USDC",
              l1,
              step1Input,
              step1Output,
              result.signature1 ?? "",
              result.step1 ? "SUCCESS" : "FAILED"
            );
            await insertTx(
              executionId,
              2,
              l1,
              l2,
              step2Input,
              step2Output,
              result.signature2 ?? "",
              result.step2 ? "SUCCESS" : "FAILED"
            );
            await insertTx(
              executionId,
              3,
              l2,
              "USDC",
              step3Input,
              step3Output,
              result.signature3 ?? "",
              result.step3 ? "SUCCESS" : "FAILED"
            );
          } catch (e) {
            console.error("[DB] updateExecution/insertTx failed:", e);
          }
        }

        if (opportunityId !== null && isDbEnabled()) {
          try {
            await updateOpportunityStatus(opportunityId, "EXECUTED");
          } catch (e) {
            console.error("[DB] updateOpportunityStatus failed:", e);
          }
        }

        if (success) {
          console.log("交易已上链:", result.signature1, result.signature2, result.signature3);
        }
      } else {
        console.log("  本轮未发现满足条件的套利机会");
      }
    } catch (err) {
      console.error("Tick error:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
