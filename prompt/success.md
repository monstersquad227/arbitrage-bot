monstersquad@MonsterdeMac-mini arbitrage-bot % npm start 

> arbitrage-bot@1.0.0 start
> node dist/index.js

Arbitrage bot started. Wallet: DnwSNxJfQYHhtFboSDbqx1szVWgdf72AC1mayVA2AA4k
Poll interval: 5000 ms
DRY_RUN (不真实交易): false
每笔套利金额: 1.99 USDC (raw: 1990000)
---

[预检查] 钱包余额: SOL 0.036826
[扫描] 正在检测套利机会...
  尝试路径: USDC → USD1 → SOL → USDC
    Step1 报价: 1.99 USDC → 1991194 USD1 (raw)
    Step2 报价: 1991194 USD1 → 24121302 SOL (最少)
    Step3 报价: 24128540 SOL → 1.989421 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.989421 USDC | 利润 0.000000 USDC (0 bps)
    未达最低利润阈值 (0.1%)，跳过
  尝试路径: USDC → USD1 → USDT → USDC
    Step1 报价: 1.99 USDC → 1990748 USD1 (raw)
    Step2 报价: 1990748 USD1 → 1989638 USDT (最少)
    Step3 报价: 1990235 USDT → 1.989598 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.989598 USDC | 利润 0.000000 USDC (0 bps)
    未达最低利润阈值 (0.1%)，跳过
  尝试路径: USDC → USD1 → LIT → USDC
    Step1 报价: 1.99 USDC → 1990785 USD1 (raw)
    Step2 报价: 1990785 USD1 → 142640939 LIT (最少)
    Step3 报价: 142683744 LIT → 1.981610 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.981610 USDC | 利润 0.000000 USDC (0 bps)
    未达最低利润阈值 (0.1%)，跳过
  尝试路径: USDC → SOL → USD1 → USDC
    Step1 报价: 1.99 USDC → 24218267 SOL (raw)
    Step2 报价: 24218267 SOL → 1997723 USD1 (最少)
    Step3 报价: 1998322 USD1 → 1.997171 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.997171 USDC | 利润 0.007171 USDC (36 bps)
    ✓ 发现套利机会

[套利机会] USDC → SOL → USD1 → USDC | 预期收回 1.997171 USDC | 利润 0.007171 USDC (36 bps)

========== 执行三角套利 ==========
  路径: USDC → SOL → USD1 → USDC | 预期利润 0.007171 USDC (36 bps)
  Step1: 提交 USDC → SOL ...
  Step1 成功: uw8xHtLMRTq3YTTmjEJ7YVBG4a9564kz1DVTNo7ySdPsP3NPMHcBoxQJ2hrsF2bR3ipeG3HtxJZ3VFeGybfdWAm
  Step2: 请求订单（钱包已持有 SOL）...
  Step2: 提交 SOL → USD1 ...
  Step2 成功: 3yss4pLYv4xJ6iTDNahmU1oA5WZWMPAekAPgLzKYfcP97PPGVPRN76kXrzGtutt2WmySqAepS2w6yXfVCceda8w
  Step3: 请求订单（USD1 → USDC）...
  Step3: 提交 USD1 → USDC ...
  Step3 成功: 3PK36bZXHhEQACyR1JhUCZz4EHzA7ink8S7QrQmovW4GHQ7VRuPgKnfZpkAo8Lv4YVxkXjmjwuotvNAxj3oJK6n5
========== 三角套利完成 ==========

交易已上链: uw8xHtLMRTq3YTTmjEJ7YVBG4a9564kz1DVTNo7ySdPsP3NPMHcBoxQJ2hrsF2bR3ipeG3HtxJZ3VFeGybfdWAm 3yss4pLYv4xJ6iTDNahmU1oA5WZWMPAekAPgLzKYfcP97PPGVPRN76kXrzGtutt2WmySqAepS2w6yXfVCceda8w 3PK36bZXHhEQACyR1JhUCZz4EHzA7ink8S7QrQmovW4GHQ7VRuPgKnfZpkAo8Lv4YVxkXjmjwuotvNAxj3oJK6n5

[预检查] 钱包余额: SOL 0.036789
[扫描] 正在检测套利机会...
  尝试路径: USDC → USD1 → SOL → USDC
^C
monstersquad@MonsterdeMac-mini arbitrage-bot % 