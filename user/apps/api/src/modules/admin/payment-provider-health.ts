import {
  isProductionMockRechargeBlocked,
  isRechargeEndpointEnabled,
  type PaymentProviderMode
} from "../wallet/payment-provider.js";

export interface PaymentRechargeActivitySummary {
  rechargeWindowHours: number;
  rechargeWindowStartedAt: string;
  recentRechargeTransactions: number;
  recentRechargeAmount: string;
  latestRechargeAt: string | null;
  recentRechargeSamples: PaymentRechargeActivitySample[];
}

export interface PaymentRechargeActivitySample {
  id: string;
  walletId: string;
  userId?: string | null;
  userEmail?: string | null;
  amount: string;
  balanceAfter: string;
  currency: string;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
}

export interface PaymentProviderHealthInput {
  provider: PaymentProviderMode;
  nodeEnv: string;
  allowProductionMockRecharge: boolean;
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
  salesList: true;
  actionHint: string;
  message: string;
}

export interface PaymentProviderHealthSample extends PaymentRechargeActivitySample {
  type: "recent_recharge_transaction";
  walletTransactionId: string;
  walletTransactionList: true;
  walletTransactionType: "recharge";
  walletLookup: string;
  walletList: true;
  salesList: true;
  message: string;
}

export function inspectPaymentProviderHealth(input: PaymentProviderHealthInput) {
  const issues: PaymentProviderHealthIssue[] = [];
  const { recentRechargeSamples, ...rechargeMetrics } = input.rechargeActivity;
  const samples = recentRechargeSamples.map(paymentProviderSample);
  const policy = {
    provider: input.provider,
    nodeEnv: input.nodeEnv,
    allowProductionMockRecharge: input.allowProductionMockRecharge
  };
  const rechargeEndpointEnabled = isRechargeEndpointEnabled(policy);
  const productionMockRechargeBlocked = isProductionMockRechargeBlocked(policy);
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
  } else if (input.provider === "mock" && input.nodeEnv === "production" && input.allowProductionMockRecharge) {
    status = "warning";
    summary = "生产环境显式启用 mock 充值";
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
  } else if (productionMockRechargeBlocked && input.rechargeActivity.recentRechargeTransactions > 0) {
    status = "warning";
    summary = "生产 mock 充值已禁用但存在近期充值流水";
    issues.push(paymentProviderIssue({
      id: "production_mock_recharge_recent_ledger",
      type: "production_mock_recharge_recent_ledger",
      severity: "warning",
      actionHint: "Production mock recharge is now blocked by default, but recent recharge ledger rows still exist; review balances and sales before treating them as real paid revenue.",
      message: `Production mock recharge is blocked, but ${input.rechargeActivity.recentRechargeTransactions} recharge transaction(s) exist in the last ${input.rechargeActivity.rechargeWindowHours} hours.`
    }));
  } else if (productionMockRechargeBlocked) {
    summary = "生产 mock 充值已禁用";
  }

  return {
    status,
    summary,
    metrics: {
      provider: input.provider,
      nodeEnv: input.nodeEnv,
      minRechargeAmount: input.minRechargeAmount,
      allowProductionMockRecharge: input.allowProductionMockRecharge,
      rechargeEndpointEnabled,
      productionMockRechargeBlocked,
      ...rechargeMetrics,
      recentRechargeSamples: samples.length
    },
    issues,
    samples
  };
}

function paymentProviderIssue(input: Pick<PaymentProviderHealthIssue, "id" | "type" | "severity" | "actionHint" | "message">): PaymentProviderHealthIssue {
  return {
    ...input,
    refId: "PAYMENT_PROVIDER",
    walletList: true,
    walletTransactionList: true,
    walletTransactionType: "recharge",
    salesList: true
  };
}

function paymentProviderSample(sample: PaymentRechargeActivitySample): PaymentProviderHealthSample {
  const actor = sample.userEmail ?? sample.userId ?? sample.walletId;
  return {
    ...sample,
    id: `payment_recharge:${sample.id}`,
    type: "recent_recharge_transaction",
    walletTransactionId: sample.id,
    walletTransactionList: true,
    walletTransactionType: "recharge",
    walletLookup: sample.walletId,
    walletList: true,
    salesList: true,
    message: `${actor} recharged ${sample.amount} ${sample.currency}; balanceAfter=${sample.balanceAfter}`
  };
}
