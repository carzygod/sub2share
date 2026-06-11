export type PaymentProviderMode = "mock" | "disabled";

export interface PaymentRechargeActivitySummary {
  rechargeWindowHours: number;
  rechargeWindowStartedAt: string;
  recentRechargeTransactions: number;
  recentRechargeAmount: string;
  latestRechargeAt: string | null;
}

export interface PaymentProviderHealthInput {
  provider: PaymentProviderMode;
  nodeEnv: string;
  minRechargeAmount: number;
  rechargeActivity: PaymentRechargeActivitySummary;
}

export interface PaymentProviderHealthIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  refId: string;
  walletList: true;
  walletTransactionList: true;
  walletTransactionType: "recharge";
  actionHint: string;
  message: string;
}

export function inspectPaymentProviderHealth(input: PaymentProviderHealthInput) {
  const issues: PaymentProviderHealthIssue[] = [];
  let status: "ok" | "warning" | "error" = "ok";
  let summary = "充值配置可用";

  if (input.provider === "disabled") {
    status = "error";
    summary = "充值入口已禁用";
    issues.push(paymentProviderIssue({
      id: "payment_provider_disabled",
      type: "payment_provider_disabled",
      severity: "error",
      actionHint: "Enable a supported recharge provider only after the wallet recharge flow is intentionally available to users.",
      message: "PAYMENT_PROVIDER=disabled, user wallet recharge endpoint returns 503."
    }));
  } else if (input.provider === "mock" && input.nodeEnv === "production") {
    status = "warning";
    summary = "生产环境仍启用 mock 充值";
    issues.push(paymentProviderIssue({
      id: "production_mock_recharge",
      type: "production_mock_recharge",
      severity: "warning",
      actionHint: input.rechargeActivity.recentRechargeTransactions > 0
        ? "Production mock recharge has written recent wallet ledger rows; review recharge transactions before treating balances and sales as paid revenue."
        : "Do not rely on mock recharge for public billing; integrate a real payment provider and webhook flow, or keep the service internal until then.",
      message: input.rechargeActivity.recentRechargeTransactions > 0
        ? `Production is using mock wallet recharge and wrote ${input.rechargeActivity.recentRechargeTransactions} recharge transaction(s) in the last ${input.rechargeActivity.rechargeWindowHours} hours.`
        : "Production is using mock wallet recharge. Replace with a real payment provider before public billing."
    }));
  }

  return {
    status,
    summary,
    metrics: {
      provider: input.provider,
      nodeEnv: input.nodeEnv,
      minRechargeAmount: input.minRechargeAmount,
      rechargeEndpointEnabled: input.provider === "mock",
      ...input.rechargeActivity
    },
    issues
  };
}

function paymentProviderIssue(input: Pick<PaymentProviderHealthIssue, "id" | "type" | "severity" | "actionHint" | "message">): PaymentProviderHealthIssue {
  return {
    ...input,
    refId: "PAYMENT_PROVIDER",
    walletList: true,
    walletTransactionList: true,
    walletTransactionType: "recharge"
  };
}
