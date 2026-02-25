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