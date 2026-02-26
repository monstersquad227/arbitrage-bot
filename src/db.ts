import mysql from "mysql2/promise";

const DB_HOST = process.env.DB_HOST ?? "";
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER ?? "";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "";
const DB_NAME = process.env.DB_NAME ?? "";

let pool: mysql.Pool | null = null;

export function isDbEnabled(): boolean {
  return Boolean(DB_HOST && DB_USER && DB_NAME);
}

function getPool(): mysql.Pool {
  if (!pool) {
    if (!isDbEnabled()) {
      throw new Error("DB not configured: set DB_HOST, DB_USER, DB_NAME");
    }
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return pool;
}

/** 插入扫描记录，返回 scan_id（含 SOL、USDC 余额） */
export async function insertScan(
  walletAddress: string,
  walletSolBalance: number | null,
  walletUsdcBalance: number | null = null
): Promise<number> {
  const conn = await getPool().getConnection();
  try {
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO arbitrage_scan (wallet_address, wallet_sol_balance, wallet_usdc_balance, scan_start_time)
       VALUES (?, ?, ?, NOW(6))`,
      [walletAddress, walletSolBalance, walletUsdcBalance]
    );
    return result.insertId;
  } finally {
    conn.release();
  }
}

/** 更新扫描记录：结束时间、扫描路径数、发现机会数 */
export async function updateScan(
  scanId: number,
  scanEndTime: Date,
  scannedPaths: number,
  foundOpportunities: number
): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.execute(
      `UPDATE arbitrage_scan
       SET scan_end_time = ?, scanned_paths = ?, found_opportunities = ?
       WHERE id = ?`,
      [scanEndTime, scannedPaths, foundOpportunities, scanId]
    );
  } finally {
    conn.release();
  }
}

/** 插入套利机会，返回 opportunity_id */
export async function insertOpportunity(
  scanId: number,
  path: string,
  inputToken: string,
  inputAmount: string,
  expectedOutputAmount: string,
  expectedProfit: string,
  expectedProfitBps: number,
  minProfitThresholdBps: number,
  status: "SKIPPED" | "EXECUTED"
): Promise<number> {
  const conn = await getPool().getConnection();
  try {
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO arbitrage_opportunity
       (scan_id, path, input_token, input_amount, expected_output_amount,
        expected_profit, expected_profit_bps, min_profit_threshold_bps, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        path,
        inputToken,
        inputAmount,
        expectedOutputAmount,
        expectedProfit,
        expectedProfitBps,
        minProfitThresholdBps,
        status,
      ]
    );
    return result.insertId;
  } finally {
    conn.release();
  }
}

export async function updateOpportunityStatus(
  opportunityId: number,
  status: "SKIPPED" | "EXECUTED"
): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.execute(
      `UPDATE arbitrage_opportunity SET status = ? WHERE id = ?`,
      [status, opportunityId]
    );
  } finally {
    conn.release();
  }
}

/** 插入执行记录，返回 execution_id */
export async function insertExecution(
  opportunityId: number,
  startTime: Date
): Promise<number> {
  const conn = await getPool().getConnection();
  try {
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO arbitrage_execution (opportunity_id, start_time) VALUES (?, ?)`,
      [opportunityId, startTime]
    );
    return result.insertId;
  } finally {
    conn.release();
  }
}

/** 更新执行记录：结束时间、实际输出/利润、gas、状态、错误信息 */
export async function updateExecution(
  executionId: number,
  endTime: Date,
  status: "SUCCESS" | "FAILED",
  opts: {
    actualOutputAmount?: string | null;
    actualProfit?: string | null;
    actualProfitBps?: number | null;
    gasFeeSol?: string | null;
    errorMessage?: string | null;
  } = {}
): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.execute(
      `UPDATE arbitrage_execution SET
         end_time = ?, actual_output_amount = ?, actual_profit = ?,
         actual_profit_bps = ?, gas_fee_sol = ?, status = ?, error_message = ?
       WHERE id = ?`,
      [
        endTime,
        opts.actualOutputAmount ?? null,
        opts.actualProfit ?? null,
        opts.actualProfitBps ?? null,
        opts.gasFeeSol ?? null,
        status,
        opts.errorMessage ?? null,
        executionId,
      ]
    );
  } finally {
    conn.release();
  }
}

/** 插入单笔交易记录（三步中的一步） */
export async function insertTx(
  executionId: number,
  stepNumber: 1 | 2 | 3,
  fromToken: string,
  toToken: string,
  inputAmount: string,
  outputAmount: string,
  txSignature: string,
  status: "SUCCESS" | "FAILED"
): Promise<void> {
  const conn = await getPool().getConnection();
  try {
    await conn.execute(
      `INSERT INTO arbitrage_tx
       (execution_id, step_number, from_token, to_token, input_amount, output_amount, tx_signature, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        executionId,
        stepNumber,
        fromToken,
        toToken,
        inputAmount,
        outputAmount,
        txSignature,
        status,
      ]
    );
  } finally {
    conn.release();
  }
}
