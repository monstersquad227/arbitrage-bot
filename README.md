# 套利机器人 (Arbitrage Bot)

基于 **Jupiter Ultra Swap API** 的 Solana 三角套利机器人，使用 TypeScript 实现。

## 规格

| 项目     | 值 |
|----------|----|
| 语言     | TypeScript |
| API      | Jupiter Ultra Swap API |
| 最低利润 | 扣除手续费后 0.1% |
| 单次套利金额 | 0.5 USDC |
| 最大滑点 | 50 bps (0.5%) |

## 环境要求

- Node.js 18+
- Solana 钱包（需有少量 USDC 和 SOL 用于 gas）

## 安装

```bash
npm install
```

## 配置

复制环境变量示例并填写：

```bash
cp .env.example .env
```

在 `.env` 中设置：

- **JUPITER_API_KEY**：在 [Jupiter Portal](https://portal.jup.ag) 申请 API Key
- **PRIVATE_KEY**：钱包私钥（Base58 格式）
- **POLL_INTERVAL_MS**（可选）：轮询间隔毫秒数，默认 5000

## 运行

```bash
npm run build
npm start
```

或一键构建并运行：

```bash
npm run arb
```

## 策略说明

1. 轮询检测三角套利机会：**USDC → 中间代币 → USDC**
2. 中间代币包括：SOL、BONK、USDT
3. 对每条路径请求 Jupiter 报价（Get Order），计算 round-trip 后收回的 USDC
4. 若扣除手续费后利润 ≥ 0.1%，则依次执行两笔 swap（先 USDC→中间币，再中间币→USDC）
5. 使用最大滑点 50 bps、单次 0.5 USDC 参与套利

## 风险提示

- 仅限主网（mainnet-beta），涉及真实资金
- 报价与成交间存在延迟，实际收益可能低于预期或亏损
- 请先用小金额测试，并自行承担使用风险

## 项目结构

```
src/
  config.ts    # 常量与环境变量
  types.ts     # API 响应类型
  jupiter.ts   # Jupiter Ultra 下单与执行
  arbitrage.ts # 套利发现与执行逻辑
  index.ts     # 主循环入口
```
