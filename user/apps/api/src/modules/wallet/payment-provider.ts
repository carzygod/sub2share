export type PaymentProviderMode = "mock" | "disabled";

export interface RechargeEndpointPolicyInput {
  provider: PaymentProviderMode;
  nodeEnv: string;
  allowProductionMockRecharge: boolean;
}

export function isRechargeEndpointEnabled(input: RechargeEndpointPolicyInput) {
  return input.provider === "mock" && (input.nodeEnv !== "production" || input.allowProductionMockRecharge);
}

export function isProductionMockRechargeBlocked(input: RechargeEndpointPolicyInput) {
  return input.provider === "mock" && input.nodeEnv === "production" && !input.allowProductionMockRecharge;
}
