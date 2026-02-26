# 套利机器人实现

## 代码语言
+ TypeScript
## 工具
+ Jupiter API（Ultra Swap API）
## 功能
+ 最低利润阈值（扣除手续费后）0.1%
+ 每次套利金额（USDC）0.5
+ 最大滑点 50

## PART1 
+ 不要真正的交易
+ 网络请求超时，使用代理，代理地址：http://127.0.0.1:7890

## 优化
+ 想看到套利的过程

## PART2
+ 预检查钱包里面的余额是否足够

### 套利路径
+ 使用 SOL -> 中间 -> SOL

## PART3
### 套利路径
+ 使用三角套利 SOL -> 角1 -> 角2 -> SOL
### 优化
#### 增加一些新池子
+ Monad
+ USD1
+ WSOL
+ USDT
+ USDC
#### 套利策略
+ 现有账户余额为0.07546sol，帮我优化利润率和滑点

## PART4
### 套利路径
+ 更改套利路径为 USDC --> corne1 --> corner2 --> USDC
### 重置池子为下列
+ USD1:USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB
+ WSOL:So11111111111111111111111111111111111111112
+ USDT:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
+ LIT: EicWvteVi2fWepEzS3FYWsnuPoP6caZfjnKqNvydLjCH
### 策略
+ 每次 1.99 买入，利润率为0.1% 滑点帮我计算下，确保我能够盈利（哪怕一点点）

### 报错
npm start

> arbitrage-bot@1.0.0 start
> node dist/index.js

Arbitrage bot started. Wallet: DnwSNxJfQYHhtFboSDbqx1szVWgdf72AC1mayVA2AA4k
Poll interval: 5000 ms
DRY_RUN (不真实交易): false
每笔套利金额: 1.99 USDC (raw: 1990000)
---

[预检查] 钱包余额: SOL 0.039145
[扫描] 正在检测套利机会...
  尝试路径: USDC → USD1 → SOL → USDC
    Step1 报价: 1.99 USDC → 1990899 USD1 (raw)
    Step2 报价: 1990899 USD1 → 24153453 SOL (最少)
    Step3 报价: 24160701 SOL → 1.989591 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.989591 USDC | 利润 0.000000 USDC (0 bps)
    未达最低利润阈值 (0.1%)，跳过
  尝试路径: USDC → USD1 → USDT → USDC
    Step1 报价: 1.99 USDC → 1990899 USD1 (raw)
    Step2 报价: 1990899 USD1 → 1989852 USDT (最少)
    Step3 报价: 1990449 USDT → 1.989748 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.989748 USDC | 利润 0.000000 USDC (0 bps)
    未达最低利润阈值 (0.1%)，跳过
  尝试路径: USDC → USD1 → LIT → USDC
    Step1 报价: 1.99 USDC → 1990926 USD1 (raw)
    Step2 报价: 1990926 USD1 → 144268907 LIT (最少)
    Step3 报价: 144312200 LIT → 1.992660 USDC (最少)
     round-trip: 投入 1.99 USDC → 收回 1.992660 USDC | 利润 0.002660 USDC (13 bps)
    ✓ 发现套利机会

[套利机会] USDC → USD1 → LIT → USDC | 预期收回 1.992660 USDC | 利润 0.002660 USDC (13 bps)

========== 执行三角套利 ==========
  路径: USDC → USD1 → LIT → USDC | 预期利润 0.002660 USDC (13 bps)
  Step1: 提交 USDC → USD1 ...
  Step1 成功: 1Y28gQgG1YD7FN9eyzymzQ5M2uZtKtgQnz6tT2PLUX7QZs8grBeYTZE4PCVmPp1kZNfBRZ6v3Vp4skPzKvgbzms
  Step2: 请求订单（钱包已持有 USD1）...
  Step2 订单请求失败: Insufficient funds

[预检查] 钱包余额: SOL 0.036912
[扫描] 正在检测套利机会...
  尝试路径: USDC → USD1 → SOL → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → USD1 → USDT → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → USD1 → LIT → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → SOL → USD1 → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → SOL → USDT → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → SOL → LIT → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → USDT → USD1 → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → USDT → SOL → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → USDT → LIT → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → LIT → USD1 → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → LIT → SOL → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → LIT → USDT → USDC
    Step1 报价失败或无交易: Insufficient funds
  本轮未发现满足条件的套利机会

[预检查] 钱包余额: SOL 0.036912
[扫描] 正在检测套利机会...
  尝试路径: USDC → USD1 → SOL → USDC
    Step1 报价失败或无交易: Insufficient funds
  尝试路径: USDC → USD1 → USDT → USDC
^C
+ USDC → USD1 → LIT → USDC 这条路径已经有了，但是为什么step2的时候交易失败了

## 优化
+ step2 、 step3 换成真实的交易，和step1一样