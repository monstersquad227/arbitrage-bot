import { getWallet } from "./jupiter.js";
import { POLL_INTERVAL_MS, DRY_RUN } from "./config.js";
import {
  findOpportunity,
  runArbitrage,
  logOpportunity,
} from "./arbitrage.js";

async function main(): Promise<void> {
  const wallet = getWallet();
  const taker = wallet.publicKey.toBase58();
  console.log("Arbitrage bot started. Wallet:", taker);
  console.log("Poll interval:", POLL_INTERVAL_MS, "ms");
  console.log("DRY_RUN (不真实交易):", DRY_RUN);
  console.log("---");

  for (;;) {
    try {
      console.log("\n[扫描] 正在检测套利机会...");
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
        if (result.step1 && result.step2) {
          console.log("交易已上链:", result.signature1, result.signature2);
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
