import { getWallet } from "./jupiter.js";
import { POLL_INTERVAL_MS, DRY_RUN, TRADE_AMOUNT_SOL, TRADE_AMOUNT_RAW } from "./config.js";
import {
  findOpportunity,
  runArbitrage,
  logOpportunity,
} from "./arbitrage.js";
import { checkWalletBalance, formatSol } from "./balance.js";

async function main(): Promise<void> {
  const wallet = getWallet();
  const taker = wallet.publicKey.toBase58();
  console.log("Arbitrage bot started. Wallet:", taker);
  console.log("Poll interval:", POLL_INTERVAL_MS, "ms");
  console.log("DRY_RUN (不真实交易):", DRY_RUN);
  console.log("每笔套利金额:", TRADE_AMOUNT_SOL, "SOL (raw:", TRADE_AMOUNT_RAW.toString() + ")");
  console.log("---");

  for (;;) {
    try {
      const balance = await checkWalletBalance(wallet.publicKey);
      console.log("\n[预检查] 钱包余额: SOL", formatSol(balance.solLamports));
      if (!balance.ok) {
        console.log("[预检查] 跳过本轮:", balance.message);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      console.log("[扫描] 正在检测套利机会...");
      const opp = await findOpportunity(taker);
      if (opp) {
        logOpportunity(opp);
        if (DRY_RUN) {
          console.log("[DRY_RUN] 仅检测，未提交交易");
          console.log("");
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        const result = await runArbitrage(wallet, opp);
        if (result.step1 && result.step2 && result.step3) {
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
