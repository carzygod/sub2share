export const APP_NAME = "智算驿站";

export const resourceTypes = ["codex", "claude_code", "gemini", "antigravity"] as const;
export type ResourceType = (typeof resourceTypes)[number];

export const rentalStatuses = [
  "active",
  "low_balance",
  "limited",
  "suspended",
  "expired",
  "refunded",
  "closed"
] as const;
export type RentalStatus = (typeof rentalStatuses)[number];

export const supplierLevels = ["L0", "L1", "L2", "L3", "L4"] as const;
export type SupplierLevel = (typeof supplierLevels)[number];

export const supplierShareRates: Record<SupplierLevel, number> = {
  L0: 0.7,
  L1: 0.75,
  L2: 0.8,
  L3: 0.85,
  L4: 0.9
};

export const productBillingModes = ["pay_as_you_go", "daily", "weekly", "monthly"] as const;
export type ProductBillingMode = (typeof productBillingModes)[number];

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  requestId: string;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

