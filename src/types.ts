export interface JupiterOrderResponse {
  requestId: string;
  transaction: string | null;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  inUsdValue?: number;
  outUsdValue?: number;
  feeBps?: number;
  errorCode?: number;
  errorMessage?: string;
}

export interface JupiterExecuteResponse {
  status: "Success" | "Failed";
  signature?: string;
  code?: number;
  error?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
}
