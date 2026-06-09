import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  Download,
  Filter,
  KeyRound,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { api, clearAdminToken, saveAdminToken } from "./api";
import logoUrl from "../assets/zyz-logo.png";
import "../styles/main.css";

type View = "dashboard" | "systemHealth" | "users" | "wallets" | "walletTransactions" | "reconciliation" | "sales" | "usages" | "products" | "orders" | "rentals" | "sub2" | "proxyRequests" | "resources" | "settlements" | "withdrawals" | "audit";
type ManagedListView = "users" | "wallets" | "walletTransactions" | "sales" | "usages" | "products" | "orders" | "rentals" | "proxyRequests" | "resources" | "settlements" | "withdrawals" | "audit";
type UserStatus = "active" | "disabled" | "banned";
type ResourceStatus = "pending" | "testing" | "online" | "busy" | "paused" | "abnormal" | "disabled";

interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface PagedResult<T> extends PageMeta {
  items: T[];
}

interface PagedUsageResult extends PagedResult<UsageRecordRow> {
  summary?: AggregateSummary;
}

interface BillingSyncStateRow {
  id: string;
  cursor?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  lastImported: number;
  lastSkipped: number;
  lastUnmatched: number;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  updatedAt?: string;
}

interface BillingSyncRunRow {
  id: string;
  source: string;
  cursorIn?: string | null;
  cursorOut?: string | null;
  status: string;
  imported: number;
  skipped: number;
  unmatched: number;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

interface UsageSyncStateResult {
  state?: BillingSyncStateRow | null;
  runs: BillingSyncRunRow[];
}

interface PagedWithdrawalResult extends PagedResult<WithdrawalRow> {
  summary?: AggregateSummary;
}

interface ReconciliationSummary {
  billedUsageMissingWalletTransactions: number;
  walletTransactionsMissingUsage: number;
  usageSettlementMismatches: number;
  settlementOverallocated: number;
  withdrawalAllocationMismatches: number;
  totalIssues: number;
  returnedIssues: number;
}

interface ReconciliationIssue {
  id: string;
  severity: "warning" | "error";
  type: string;
  message: string;
  refType: string;
  refId: string;
  amount?: string;
  expected?: string;
  actual?: string;
  createdAt?: string;
}

interface ReconciliationResult {
  checkedAt: string;
  ok: boolean;
  scanLimit: number;
  summary: ReconciliationSummary;
  scanned: Record<string, number>;
  issues: ReconciliationIssue[];
}

interface ListQueryState {
  q: string;
  status: string;
  resourceType: string;
  action: string;
  page: number;
  pageSize: number;
}

interface Dashboard {
  users: number;
  activeRentals: number;
  onlineResources: number;
  pendingWithdrawals: number;
  usageCount: number;
  gmv: string;
  supplierIncome: string;
  walletAvailable: string;
  walletFrozen: string;
  totalRecharged: string;
  totalSpent: string;
  paidOrderCount: number;
  paidOrderAmount: string;
}

interface SystemHealthCheckRow {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  summary: string;
  metrics?: Record<string, string | number | boolean | null>;
  detail?: unknown;
}

interface SystemHealthResult {
  checkedAt: string;
  status: "ok" | "warning" | "error";
  summary: {
    totalChecks: number;
    ok: number;
    warning: number;
    error: number;
  };
  checks: SystemHealthCheckRow[];
}

interface SystemMaintenanceResult {
  startedAt: string;
  finishedAt: string;
  actions: {
    expireOverdueRentals?: {
      matched: number;
      expired: number;
      apiKeysDeactivated: number;
      sub2DisableFailed: number;
    };
    releaseAvailableSettlements?: {
      matched: number;
      released: number;
      amountMatched: string;
    };
    repairSub2Bindings?: {
      rentalsScanned: number;
      userBindingsUpserted: number;
      apiKeyBindingsUpserted: number;
      conflicts: unknown[];
    };
    cleanupSmokeData?: {
      rentalsMatched: number;
      rentalsClosed: number;
      ordersClosed: number;
      apiKeysDeactivated: number;
      walletReset: boolean;
      sub2KeysDisableAttempted: number;
      sub2KeysDisabled: number;
      sub2DisableFailed: number;
    };
  };
  health: SystemHealthResult;
}

interface RoleRow {
  role: string;
}

interface UserRow {
  id: string;
  email: string;
  displayName?: string | null;
  status: UserStatus;
  roles: RoleRow[];
  wallet?: WalletRow | null;
  _count?: {
    orders: number;
    rentals: number;
    apiKeys: number;
  };
  createdAt?: string;
}

interface WalletRow {
  id: string;
  userId: string;
  availableBalance: string;
  frozenBalance: string;
  totalRecharged: string;
  totalSpent: string;
  updatedAt?: string;
  user?: UserRow;
  transactions?: WalletTransactionRow[];
}

interface WalletTransactionRow {
  id: string;
  walletId: string;
  type: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  createdAt: string;
  wallet?: WalletRow;
}

interface UserIdentityRow {
  id: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface OrderRow {
  id: string;
  status: string;
  currency?: string;
  totalAmount: string;
  paidAmount: string;
  paymentRef?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: UserRow;
  items?: OrderItemRow[];
  rentals?: RentalRow[];
}

interface OrderItemRow {
  id: string;
  productId: string;
  priceId?: string | null;
  quantity: number;
  amount: string;
  meta?: unknown;
  product?: ProductRow;
}

interface ProductRow {
  id: string;
  name: string;
  resourceType: string;
  billingMode: string;
  status: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  prices?: ProductPriceRow[];
  _count?: {
    prices: number;
    orders: number;
    rentals: number;
  };
}

interface ProductPriceRow {
  id: string;
  productId: string;
  tierCode: string;
  displayName: string;
  discountRate: string;
  tierMultiplier: string;
  fixedPrice?: string | null;
  durationDays?: number | null;
  maxConcurrency: number;
  requestLimit?: number | null;
  spendLimit?: string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

interface OrderDetailRow extends OrderRow {
  user: UserRow;
  items: OrderItemRow[];
  rentals: RentalRow[];
  statusHistory?: OrderStatusHistoryRow[];
}

interface OrderStatusHistoryRow {
  id: string;
  orderId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorUserId?: string | null;
  reason?: string | null;
  meta?: unknown;
  createdAt: string;
}

interface RentalRow {
  id: string;
  status: string;
  resourceType: string;
  endpointUrl?: string | null;
  sub2KeyId?: string | null;
  createdAt: string;
  endsAt?: string | null;
  user?: UserRow;
  order?: OrderRow;
  product?: { name: string };
  apiKeys?: ApiKeyRow[];
  limits?: {
    maxConcurrency: number;
    rpmLimit?: number | null;
    tpmLimit?: number | null;
    requestLimit?: number | null;
    spendLimit?: string | null;
    remainingSpend?: string | null;
  } | null;
}

interface ResourceRow {
  id: string;
  resourceType: string;
  status: ResourceStatus;
  level: string;
  shareRate?: string;
  dailyCap?: string | null;
  reserveRatio?: string;
  maxConcurrency: number;
  sub2AccountId?: string | null;
  lastCheckedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  supplier?: {
    id: string;
    displayName?: string | null;
    status?: string;
    defaultShareRate?: string;
    user?: UserRow;
  };
}

interface WithdrawalRow {
  id: string;
  supplierId?: string;
  amount: string;
  currency?: string;
  status: string;
  payoutRef?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt?: string;
  supplier?: {
    id: string;
    displayName?: string | null;
    user?: UserRow;
  };
  settlements?: WithdrawalSettlementRow[];
}

interface WithdrawalSettlementRow {
  id: string;
  amount: string;
  status: string;
  settlementRecord?: SettlementRow;
}

interface SupplierDetailRow {
  id: string;
  displayName?: string | null;
  status: string;
  defaultShareRate: string;
  resources?: ResourceRow[];
  withdrawals?: WithdrawalRow[];
}

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt?: string | null;
  createdAt: string;
}

interface ProxyRequestLogRow {
  id: string;
  requestId: string;
  userId?: string | null;
  rentalId?: string | null;
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  method: string;
  path: string;
  statusCode?: number | null;
  upstreamStatusCode?: number | null;
  errorCode?: string | null;
  durationMs: number;
  requestBytes: number;
  estimatedInputTokens: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: Pick<UserRow, "id" | "email" | "displayName"> | null;
  rental?: {
    id: string;
    resourceType: string;
    status: string;
    product?: { name: string } | null;
  } | null;
  apiKey?: {
    id: string;
    name: string;
    keyPrefix: string;
    status: string;
  } | null;
}

interface UserDetailRow extends UserRow {
  phone?: string | null;
  updatedAt?: string;
  identities?: UserIdentityRow[];
  orders?: OrderRow[];
  rentals?: RentalRow[];
  apiKeys?: ApiKeyRow[];
  supplier?: SupplierDetailRow | null;
}

interface SettlementRow {
  id: string;
  amount: string;
  reservedAmount?: string;
  withdrawnAmount?: string;
  status: string;
  shareRate: string;
  availableAt?: string | null;
  createdAt: string;
  supplierResource?: ResourceRow;
  usageRecord?: UsageRecordRow | null;
}

interface UsageRecordRow {
  id: string;
  sub2RequestId: string;
  rentalId: string;
  userId: string;
  resourceType: string;
  model?: string | null;
  inputUnits: string;
  outputUnits: string;
  apiEquivalentCost: string;
  buyerCharge: string;
  supplierIncome: string;
  status: string;
  occurredAt: string;
  createdAt?: string;
  updatedAt?: string;
  rental?: RentalRow;
  supplierResource?: ResourceRow | null;
  settlements?: SettlementRow[];
}

interface AggregateSummary {
  _count: number;
  _sum: Record<string, string | number | null>;
}

interface ResourceDetailRow extends ResourceRow {
  usages?: UsageRecordRow[];
  settlements?: SettlementRow[];
  usageSummary?: AggregateSummary;
  settlementSummary?: AggregateSummary;
}

interface SalesData extends PageMeta {
  items?: OrderRow[];
  orders: OrderRow[];
  summary: {
    orderCount: number;
    totalAmount: string;
    paidAmount: string;
    usageCount: number;
    usageCharge: string;
    supplierIncome: string;
  };
}

interface Sub2AccountStatus {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
  errorMessage?: string | null;
  credentialsStatus?: string | null;
  groupIds: number[];
  groupNames: string[];
  schedulable?: boolean;
  concurrency?: number;
  currentConcurrency?: number;
  lastUsedAt?: string | null;
  rateLimitedAt?: string | null;
  overloadUntil?: string | null;
  tempUnschedulableUntil?: string | null;
  tempUnschedulableReason?: string | null;
  updatedAt?: string;
}

interface Sub2Status {
  checkedAt: string;
  baseUrl: string;
  publicEndpoint: string;
  defaultGroupId?: number;
  gatewayReachable: boolean;
  ready: boolean;
  blockingReasons: string[];
  openAiGroup?: {
    id: number;
    name: string;
    platform?: string;
    status?: string;
  };
  accounts: Sub2AccountStatus[];
}

interface Sub2AccountTestResult {
  ok: boolean;
  statusCode: number;
  testedAt: string;
  events: Record<string, unknown>[];
  raw: string;
}

interface Sub2ProxySmokeTestResult {
  ok: boolean;
  checkedAt: string;
  model: string;
  gatewayBaseUrl: string;
  publicEndpoint: string;
  sub2UserId?: string;
  sub2KeyId?: string;
  keyDisabled: boolean;
  cleanupError?: string | null;
  provisioning: {
    ok: boolean;
    error?: string | null;
  };
  models: {
    ok: boolean;
    statusCode: number;
    modelCount: number;
    firstModel?: string | null;
    error?: string | null;
  };
  responses: {
    ok: boolean;
    statusCode: number;
    responseId?: string | null;
    responseStatus?: string | null;
    errorType?: string | null;
    errorMessage?: string | null;
  };
  localProxy?: {
    ok: boolean;
    endpoint: string;
    rentalId?: string | null;
    apiKeyPrefix?: string | null;
    proxyRequestLogCount: number;
    apiKeyDeactivated: boolean;
    rentalClosed: boolean;
    orderClosed: boolean;
    walletReset: boolean;
  };
}

interface Sub2BindingIssueRow {
  id: string;
  type: string;
  severity: "warning" | "error";
  rentalId?: string;
  bindingId?: string;
  sub2Type?: string;
  expected?: string | null;
  actual?: string | null;
  message: string;
}

interface Sub2BindingReconciliationResult {
  checkedAt: string;
  ok: boolean;
  scanLimit: number;
  summary: {
    rentalsScanned: number;
    bindingsScanned: number;
    totalIssues: number;
    missingUserBindings?: number;
    missingCurrentUserBindings?: number;
    missingCurrentApiKeyBindings: number;
    mismatchedCurrentBindings: number;
    orphanBindings: number;
  };
  issues: Sub2BindingIssueRow[];
}

interface Sub2BindingRepairResult {
  repairedAt: string;
  rentalsScanned: number;
  userBindingsUpserted: number;
  apiKeyBindingsUpserted: number;
  conflicts: Array<{ rentalId: string; sub2Type: string; sub2Id: string; reason: string }>;
  reconciliation: Sub2BindingReconciliationResult;
}

interface AuditLogRow {
  id: string;
  action: string;
  objectType: string;
  objectId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  actor?: {
    id: string;
    email: string;
    displayName?: string | null;
  } | null;
}

const managedListViews: ManagedListView[] = ["users", "wallets", "walletTransactions", "sales", "usages", "products", "orders", "rentals", "proxyRequests", "resources", "settlements", "withdrawals", "audit"];
const defaultListQuery: ListQueryState = { q: "", status: "", resourceType: "", action: "", page: 1, pageSize: 50 };
const defaultPageMeta: PageMeta = { total: 0, page: 1, pageSize: 50, totalPages: 1 };
const csvExportPageSize = 200;
const userStatusOptions = ["active", "disabled", "banned"];
const productStatusOptions = ["draft", "active", "offline"];
const billingModeOptions = ["pay_as_you_go", "daily", "weekly", "monthly"];
const usageStatusOptions = ["pending", "billed", "refunded", "ignored", "disputed"];
const orderStatusOptions = ["pending", "paid", "provisioning", "active", "failed", "refunding", "refunded", "expired", "cancelled", "closed"];
const rentalStatusOptions = ["active", "low_balance", "limited", "suspended", "expired", "refunded", "closed"];
const resourceStatusOptions = ["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"];
const settlementStatusOptions = ["pending", "frozen", "available", "withdrawn", "cancelled"];
const withdrawalStatusOptions = ["pending", "approved", "rejected", "paid", "cancelled"];
const walletTransactionTypeOptions = ["recharge", "freeze", "unfreeze", "consume", "refund", "withdrawal_freeze", "withdrawal_paid", "adjustment"];
const proxyStatusOptions = ["200", "400", "401", "402", "403", "404", "408", "429", "500", "502", "503", "504"];
const resourceTypeOptions = ["codex", "claude_code", "gemini", "antigravity"];

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthResult | null>(null);
  const [systemMaintenance, setSystemMaintenance] = useState<SystemMaintenanceResult | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserDetailRow | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransactionRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRow | null>(null);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [usages, setUsages] = useState<UsageRecordRow[]>([]);
  const [usageSummary, setUsageSummary] = useState<AggregateSummary | null>(null);
  const [usageSyncState, setUsageSyncState] = useState<UsageSyncStateResult | null>(null);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [selectedResource, setSelectedResource] = useState<ResourceDetailRow | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [withdrawalSummary, setWithdrawalSummary] = useState<AggregateSummary | null>(null);
  const [sales, setSales] = useState<SalesData | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [sub2Status, setSub2Status] = useState<Sub2Status | null>(null);
  const [sub2Tests, setSub2Tests] = useState<Record<number, Sub2AccountTestResult>>({});
  const [sub2Smoke, setSub2Smoke] = useState<Sub2ProxySmokeTestResult | null>(null);
  const [sub2Bindings, setSub2Bindings] = useState<Sub2BindingReconciliationResult | null>(null);
  const [proxyRequests, setProxyRequests] = useState<ProxyRequestLogRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [listQueries, setListQueries] = useState<Record<ManagedListView, ListQueryState>>(() => createDefaultListQueries());
  const [listMeta, setListMeta] = useState<Record<ManagedListView, PageMeta>>(() => createDefaultListMeta());
  const exportInProgressRef = useRef<ManagedListView | null>(null);
  const [message, setMessage] = useState("");
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem("zyz_admin_token")));

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    saveAdminToken(data.token);
    setLoggedIn(true);
    setMessage("登录成功");
    await refresh("dashboard");
  }

  async function loadPaged<T>(
    listView: ManagedListView,
    path: string,
    setter: (items: T[]) => void,
    queryOverride?: ListQueryState
  ) {
    const page = await api<PagedResult<T>>(buildListUrl(path, queryOverride ?? listQueries[listView]));
    setter(page.items);
    setListMeta((current) => ({
      ...current,
      [listView]: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadUsages(queryOverride?: ListQueryState) {
    const [page, syncState] = await Promise.all([
      api<PagedUsageResult>(buildListUrl("/api/admin/usages", queryOverride ?? listQueries.usages)),
      api<UsageSyncStateResult>("/api/admin/usages/sync-state")
    ]);
    setUsages(page.items);
    setUsageSummary(page.summary ?? null);
    setUsageSyncState(syncState);
    setListMeta((current) => ({
      ...current,
      usages: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadWithdrawals(queryOverride?: ListQueryState) {
    const page = await api<PagedWithdrawalResult>(buildListUrl("/api/admin/withdrawals", queryOverride ?? listQueries.withdrawals));
    setWithdrawals(page.items);
    setWithdrawalSummary(page.summary ?? null);
    setListMeta((current) => ({
      ...current,
      withdrawals: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadSales(queryOverride?: ListQueryState) {
    const page = await api<SalesData>(buildListUrl("/api/admin/sales", queryOverride ?? listQueries.sales));
    setSales(page);
    setListMeta((current) => ({
      ...current,
      sales: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadSub2View() {
    const [status, bindings] = await Promise.all([
      api<Sub2Status>("/api/admin/sub2/status"),
      api<Sub2BindingReconciliationResult>("/api/admin/sub2/bindings/reconciliation")
    ]);
    setSub2Status(status);
    setSub2Bindings(bindings);
  }

  async function refresh(nextView = view, queryOverride?: ListQueryState) {
    try {
      setView(nextView);
      if (nextView === "dashboard") setDashboard(await api<Dashboard>("/api/admin/dashboard"));
      if (nextView === "systemHealth") setSystemHealth(await api<SystemHealthResult>("/api/admin/system-health"));
      if (nextView === "users") await loadPaged("users", "/api/admin/users", setUsers, queryOverride);
      if (nextView === "wallets") await loadPaged("wallets", "/api/admin/wallets", setWallets, queryOverride);
      if (nextView === "walletTransactions") await loadPaged("walletTransactions", "/api/admin/wallet-transactions", setWalletTransactions, queryOverride);
      if (nextView === "reconciliation") setReconciliation(await api<ReconciliationResult>("/api/admin/reconciliation"));
      if (nextView === "sales") await loadSales(queryOverride);
      if (nextView === "usages") await loadUsages(queryOverride);
      if (nextView === "products") await loadPaged("products", "/api/admin/products", setProducts, queryOverride);
      if (nextView === "orders") await loadPaged("orders", "/api/admin/orders", setOrders, queryOverride);
      if (nextView === "rentals") await loadPaged("rentals", "/api/admin/rentals", setRentals, queryOverride);
      if (nextView === "sub2") await loadSub2View();
      if (nextView === "proxyRequests") await loadPaged("proxyRequests", "/api/admin/proxy-requests", setProxyRequests, queryOverride);
      if (nextView === "resources") await loadPaged("resources", "/api/admin/resources", setResources, queryOverride);
      if (nextView === "settlements") await loadPaged("settlements", "/api/admin/settlements", setSettlements, queryOverride);
      if (nextView === "withdrawals") await loadWithdrawals(queryOverride);
      if (nextView === "audit") await loadPaged("audit", "/api/admin/audit-logs", setAuditLogs, queryOverride);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function updateListDraft(listView: ManagedListView, patch: Partial<ListQueryState>) {
    setListQueries((current) => ({ ...current, [listView]: { ...current[listView], ...patch } }));
  }

  async function submitListFilters(listView: ManagedListView, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextQuery: ListQueryState = {
      ...listQueries[listView],
      q: String(form.get("q") || "").trim(),
      status: String(form.get("status") || "").trim(),
      resourceType: String(form.get("resourceType") || "").trim(),
      action: String(form.get("action") || "").trim(),
      page: 1,
      pageSize: Number(form.get("pageSize") || listQueries[listView].pageSize)
    };
    setListQueries((current) => ({ ...current, [listView]: nextQuery }));
    await refresh(listView, nextQuery);
  }

  async function clearListFilters(listView: ManagedListView) {
    const nextQuery = { ...defaultListQuery, pageSize: listQueries[listView].pageSize };
    setListQueries((current) => ({ ...current, [listView]: nextQuery }));
    await refresh(listView, nextQuery);
  }

  async function changeListPage(listView: ManagedListView, page: number) {
    const meta = listMeta[listView];
    const nextQuery = { ...listQueries[listView], page: Math.min(Math.max(page, 1), meta.totalPages) };
    setListQueries((current) => ({ ...current, [listView]: nextQuery }));
    await refresh(listView, nextQuery);
  }

  async function fetchAllListPages<T>(listView: ManagedListView, path: string, query: ListQueryState) {
    const baseQuery = { ...query, page: 1, pageSize: csvExportPageSize };
    const firstPage = await api<PagedResult<T>>(buildListUrl(path, baseQuery));
    const rows = [...firstPage.items];
    setMessage(`正在导出${titleFor(listView)}：${rows.length}/${firstPage.total}`);

    for (let page = 2; page <= firstPage.totalPages; page += 1) {
      const nextPage = await api<PagedResult<T>>(buildListUrl(path, { ...baseQuery, page }));
      rows.push(...nextPage.items);
      setMessage(`正在导出${titleFor(listView)}：${rows.length}/${firstPage.total}`);
    }

    return { rows, total: firstPage.total };
  }

  async function exportFilteredList(listView: ManagedListView) {
    if (exportInProgressRef.current) {
      setMessage(`${titleFor(exportInProgressRef.current)}导出仍在进行`);
      return;
    }

    exportInProgressRef.current = listView;
    try {
      const query = listQueries[listView];
      let exported = 0;

      if (listView === "users") {
        const { rows, total } = await fetchAllListPages<UserRow>(listView, "/api/admin/users", query);
        exportUsersCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "wallets") {
        const { rows, total } = await fetchAllListPages<WalletRow>(listView, "/api/admin/wallets", query);
        exportWalletsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "walletTransactions") {
        const { rows, total } = await fetchAllListPages<WalletTransactionRow>(listView, "/api/admin/wallet-transactions", query);
        exportWalletTransactionsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "sales") {
        const { rows, total } = await fetchAllListPages<OrderRow>(listView, "/api/admin/sales", query);
        exportOrdersCsv(rows, "sales-orders", "filtered-all");
        exported = total;
      }
      if (listView === "usages") {
        const { rows, total } = await fetchAllListPages<UsageRecordRow>(listView, "/api/admin/usages", query);
        exportUsagesCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "products") {
        const { rows, total } = await fetchAllListPages<ProductRow>(listView, "/api/admin/products", query);
        exportProductsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "orders") {
        const { rows, total } = await fetchAllListPages<OrderRow>(listView, "/api/admin/orders", query);
        exportOrdersCsv(rows, "orders", "filtered-all");
        exported = total;
      }
      if (listView === "rentals") {
        const { rows, total } = await fetchAllListPages<RentalRow>(listView, "/api/admin/rentals", query);
        exportRentalsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "proxyRequests") {
        const { rows, total } = await fetchAllListPages<ProxyRequestLogRow>(listView, "/api/admin/proxy-requests", query);
        exportProxyRequestsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "resources") {
        const { rows, total } = await fetchAllListPages<ResourceRow>(listView, "/api/admin/resources", query);
        exportResourcesCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "settlements") {
        const { rows, total } = await fetchAllListPages<SettlementRow>(listView, "/api/admin/settlements", query);
        exportSettlementsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "withdrawals") {
        const { rows, total } = await fetchAllListPages<WithdrawalRow>(listView, "/api/admin/withdrawals", query);
        exportWithdrawalsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "audit") {
        const { rows, total } = await fetchAllListPages<AuditLogRow>(listView, "/api/admin/audit-logs", query);
        exportAuditLogsCsv(rows, "filtered-all");
        exported = total;
      }

      setMessage(`已导出${titleFor(listView)}：${exported} 条`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      exportInProgressRef.current = null;
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roles = String(form.get("roles") || "buyer").split(",").map((role) => role.trim()).filter(Boolean);
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        displayName: form.get("displayName"),
        roles
      })
    });
    event.currentTarget.reset();
    setMessage("用户已创建");
    await refresh("users");
  }

  async function setUserStatus(userId: string, status: UserStatus) {
    await api(`/api/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("用户状态已更新");
    await refresh("users");
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function setUserRoles(userId: string, roles: string[]) {
    await api(`/api/admin/users/${userId}/roles`, {
      method: "PATCH",
      body: JSON.stringify({ roles })
    });
    setMessage("User roles updated");
    await refresh("users");
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function adjustWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") || "");
    await api(`/api/admin/users/${userId}/wallet-adjust`, {
      method: "POST",
      body: JSON.stringify({ amount: form.get("amount"), note: form.get("note") })
    });
    event.currentTarget.reset();
    setMessage("余额已调整");
    await refresh("wallets");
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: optionalFormString(form, "description"),
        resourceType: form.get("resourceType"),
        billingMode: form.get("billingMode"),
        status: form.get("status")
      })
    });
    event.currentTarget.reset();
    setMessage("Product created");
    await refresh("products");
  }

  async function setProductStatus(productId: string, status: string) {
    await api(`/api/admin/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("Product status updated");
    await refresh("products");
  }

  async function createProductPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const productId = String(form.get("productId") || "");
    await api(`/api/admin/products/${productId}/prices`, {
      method: "POST",
      body: JSON.stringify({
        tierCode: form.get("tierCode"),
        displayName: form.get("displayName"),
        fixedPrice: form.get("fixedPrice"),
        durationDays: optionalFormString(form, "durationDays"),
        maxConcurrency: form.get("maxConcurrency"),
        requestLimit: optionalFormString(form, "requestLimit"),
        spendLimit: optionalFormString(form, "spendLimit"),
        discountRate: form.get("discountRate"),
        tierMultiplier: form.get("tierMultiplier"),
        status: form.get("status")
      })
    });
    event.currentTarget.reset();
    setMessage("Product price created");
    await refresh("products");
  }

  async function setProductPriceStatus(priceId: string, status: string) {
    await api(`/api/admin/product-prices/${priceId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("Product price status updated");
    await refresh("products");
  }

  async function setRentalStatus(rentalId: string, status: string) {
    await api(`/api/admin/rentals/${rentalId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("Rental status updated");
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => rental.id === rentalId)) {
      await openOrderDetail(selectedOrder.id);
    }
  }

  async function updateRentalLimits(event: FormEvent<HTMLFormElement>, rentalId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/admin/rentals/${rentalId}/limits`, {
      method: "PATCH",
      body: JSON.stringify({
        maxConcurrency: form.get("maxConcurrency"),
        rpmLimit: nullableFormNumber(form, "rpmLimit"),
        tpmLimit: nullableFormNumber(form, "tpmLimit"),
        requestLimit: nullableFormNumber(form, "requestLimit"),
        spendLimit: nullableFormNumber(form, "spendLimit"),
        remainingSpend: nullableFormNumber(form, "remainingSpend")
      })
    });
    setMessage("Rental limits updated");
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => rental.id === rentalId)) {
      await openOrderDetail(selectedOrder.id);
    }
  }

  async function setApiKeyStatus(apiKeyId: string, status: string) {
    await api(`/api/admin/api-keys/${apiKeyId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("API key status updated");
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => (rental.apiKeys ?? []).some((apiKey) => apiKey.id === apiKeyId))) {
      await openOrderDetail(selectedOrder.id);
    }
    if (selectedUser?.apiKeys?.some((apiKey) => apiKey.id === apiKeyId)) {
      await openUserDetail(selectedUser.id);
    }
  }

  async function rotateRentalKey(rentalId: string) {
    const result = await api<{ apiKey: string; oldSub2KeyDisabled: boolean }>(`/api/admin/rentals/${rentalId}/rotate-key`, {
      method: "POST"
    });
    setMessage(`API key rotated. New key: ${result.apiKey}${result.oldSub2KeyDisabled ? "" : " (old Sub2 key disable needs manual check)"}`);
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => rental.id === rentalId)) {
      await openOrderDetail(selectedOrder.id);
    }
  }

  async function expireOverdueRentals() {
    const result = await api<{
      matched: number;
      expired: number;
      apiKeysDeactivated: number;
      sub2DisableFailed: number;
    }>("/api/admin/rentals/expire-overdue", {
      method: "POST",
      body: JSON.stringify({ limit: 200 })
    });
    setMessage(`Expired ${result.expired}/${result.matched} rentals, disabled ${result.apiKeysDeactivated} local keys${result.sub2DisableFailed ? `, ${result.sub2DisableFailed} Sub2 disables need review` : ""}`);
    await refresh("rentals");
  }

  async function runSystemMaintenance() {
    const result = await api<SystemMaintenanceResult>("/api/admin/system-maintenance/run", {
      method: "POST",
      body: JSON.stringify({})
    });
    setSystemMaintenance(result);
    setSystemHealth(result.health);
    const expired = result.actions.expireOverdueRentals?.expired ?? 0;
    const released = result.actions.releaseAvailableSettlements?.released ?? 0;
    const repaired = (result.actions.repairSub2Bindings?.userBindingsUpserted ?? 0)
      + (result.actions.repairSub2Bindings?.apiKeyBindingsUpserted ?? 0);
    const smokeCleaned = result.actions.cleanupSmokeData?.rentalsClosed ?? 0;
    setMessage(`Maintenance done: expired ${expired}, released ${released}, repaired bindings ${repaired}, cleaned smoke ${smokeCleaned}`);
  }

  async function syncSub2Usages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api<{ imported: number; skipped: number; unmatched: number; nextCursor?: string; runId?: string; cursorOut?: string }>("/api/admin/usages/sync-sub2", {
      method: "POST",
      body: JSON.stringify({ cursor: optionalFormString(form, "cursor") })
    });
    setMessage(`Usage sync imported ${result.imported}, skipped ${result.skipped}, unmatched ${result.unmatched}${result.cursorOut ? ` / cursor ${result.cursorOut}` : ""}`);
    await refresh("usages");
  }

  async function createWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/admin/withdrawals", {
      method: "POST",
      body: JSON.stringify({
        supplierEmail: form.get("supplierEmail"),
        amount: form.get("amount"),
        currency: optionalFormString(form, "currency") ?? "USD",
        status: form.get("status"),
        payoutRef: optionalFormString(form, "payoutRef"),
        note: optionalFormString(form, "note")
      })
    });
    event.currentTarget.reset();
    setMessage("Withdrawal created");
    await refresh("withdrawals");
  }

  async function releaseAvailableSettlements() {
    const result = await api<{ matched: number; released: number; amountMatched: string }>("/api/admin/settlements/release-available", {
      method: "POST",
      body: JSON.stringify({ limit: 200 })
    });
    setMessage(`Released ${result.released}/${result.matched} settlements, amount ${result.amountMatched}`);
    await refresh("settlements");
  }

  async function setWithdrawalStatus(withdrawalId: string, status: string, payoutRef?: string) {
    await api(`/api/admin/withdrawals/${withdrawalId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, payoutRef })
    });
    setMessage("Withdrawal status updated");
    await refresh("withdrawals");
  }

  async function openUserDetail(userId: string) {
    try {
      setSelectedUser(await api<UserDetailRow>(`/api/admin/users/${userId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openOrderDetail(orderId: string) {
    try {
      setSelectedOrder(await api<OrderDetailRow>(`/api/admin/orders/${orderId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancelOrder(orderId: string) {
    const result = await api<{ cancelled: boolean }>(`/api/admin/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ note: "admin cancelled order" })
    });
    setMessage(result.cancelled ? "Order cancelled" : "Order was already cancelled");
    await refresh(view === "sales" ? "sales" : "orders");
    if (selectedOrder?.id === orderId) await openOrderDetail(orderId);
  }

  async function refundOrder(orderId: string) {
    const result = await api<{ refundAmount: string; walletRefunded: boolean; sub2Sync: unknown[] }>(`/api/admin/orders/${orderId}/refund`, {
      method: "POST",
      body: JSON.stringify({ note: "admin refunded order" })
    });
    setMessage(`Order refunded ${money(result.refundAmount)}${result.walletRefunded ? "" : " (wallet already had refund)"}`);
    await refresh(view === "sales" ? "sales" : "orders");
    if (selectedOrder?.id === orderId) await openOrderDetail(orderId);
  }

  async function openResourceDetail(resourceId: string) {
    try {
      setSelectedResource(await api<ResourceDetailRow>(`/api/admin/resources/${resourceId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function setResourceStatus(resourceId: string, status: ResourceStatus) {
    await api(`/api/admin/resources/${resourceId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("资源状态已更新");
    await refresh("resources");
    if (selectedResource?.id === resourceId) await openResourceDetail(resourceId);
  }

  async function testResource(resourceId: string) {
    const result = await api<{ result: { ok: boolean; statusCode: number }; resource: ResourceRow }>(`/api/admin/resources/${resourceId}/test`, {
      method: "POST"
    });
    setMessage(`Resource test ${result.result.ok ? "passed" : "failed"} / HTTP ${result.result.statusCode} / status ${result.resource.status}`);
    await refresh("resources");
    if (selectedResource?.id === resourceId) await openResourceDetail(resourceId);
  }

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const resource = await api<ResourceRow>("/api/admin/resources", {
      method: "POST",
      body: JSON.stringify({
        supplierEmail: form.get("supplierEmail"),
        displayName: optionalFormString(form, "displayName"),
        resourceType: form.get("resourceType"),
        status: form.get("status"),
        level: form.get("level"),
        maxConcurrency: form.get("maxConcurrency"),
        shareRate: form.get("shareRate"),
        reserveRatio: form.get("reserveRatio"),
        dailyCap: optionalFormString(form, "dailyCap"),
        sub2AccountId: optionalFormString(form, "sub2AccountId")
      })
    });
    event.currentTarget.reset();
    setMessage("共享资源已创建");
    await refresh("resources");
    await openResourceDetail(resource.id);
  }

  async function refreshSub2Account(accountId: number) {
    const result = await api<{ ok: boolean; error?: string | null }>(`/api/admin/sub2/accounts/${accountId}/refresh`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage(result.ok ? "Sub2 上游账号刷新已触发" : `刷新失败：${result.error ?? "未知错误"}`);
    await refresh("sub2");
  }

  async function testSub2Account(accountId: number) {
    const result = await api<Sub2AccountTestResult>(`/api/admin/sub2/accounts/${accountId}/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setSub2Tests((current) => ({ ...current, [accountId]: result }));
    setMessage(result.ok ? "Sub2 上游账号测试通过" : `测试失败：${testSummary(result)}`);
    await refresh("sub2");
  }

  async function runSub2SmokeTest() {
    const result = await api<Sub2ProxySmokeTestResult>("/api/admin/sub2/proxy-smoke-test", {
      method: "POST",
      body: JSON.stringify({})
    });
    setSub2Smoke(result);
    setMessage(result.ok ? "Codex 反代端到端自检通过" : `反代自检失败：${smokeSummary(result)}`);
    await refresh("sub2");
  }

  async function checkSub2Bindings() {
    const result = await api<Sub2BindingReconciliationResult>("/api/admin/sub2/bindings/reconciliation");
    setSub2Bindings(result);
    setMessage(result.ok ? "Sub2 bindings are consistent" : `Sub2 bindings need review: ${result.summary.totalIssues} issues`);
  }

  async function repairSub2Bindings() {
    const result = await api<Sub2BindingRepairResult>("/api/admin/sub2/bindings/repair", {
      method: "POST",
      body: JSON.stringify({})
    });
    setSub2Bindings(result.reconciliation);
    setMessage(`Sub2 bindings repaired: user ${result.userBindingsUpserted}, api_key ${result.apiKeyBindingsUpserted}, conflicts ${result.conflicts.length}`);
    await refresh("sub2");
  }

  async function applySub2RefreshToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("accountId") || "");
    const clientId = String(form.get("clientId") || "").trim();
    const refreshToken = String(form.get("refreshToken") || "");
    const result = await api<{ ok: boolean; error?: string | null }>(
      `/api/admin/sub2/accounts/${accountId}/apply-openai-refresh-token`,
      {
        method: "POST",
        body: JSON.stringify({
          refreshToken,
          clientId: clientId || undefined
        })
      }
    );
    event.currentTarget.reset();
    setMessage(result.ok ? "OpenAI 上游凭据已应用" : `凭据应用失败：${result.error ?? "未知错误"}`);
    await refresh("sub2");
  }

  useEffect(() => {
    if (loggedIn) void refresh("dashboard");
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <main className="login-page">
        <section className="login-shell glass-panel">
          <div className="login-copy">
            <div className="brand-lockup">
              <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
              <div>
                <strong>智算驿站</strong>
                <span>运营中枢</span>
              </div>
            </div>
            <h1>供需调度与结算控制台</h1>
            <p>面向用户、共享资源、余额、销售和租赁的统一管理入口。</p>
          </div>
          <form onSubmit={login}>
            <span className="eyebrow">Admin Access</span>
            <h2>登录后台</h2>
            {message && <div className="notice compact">{message}</div>}
            <input name="email" type="email" placeholder="邮箱" required />
            <input name="password" type="password" placeholder="密码" required />
            <button>进入控制台</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="sidebar glass-panel">
        <div className="brand-lockup">
          <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
          <div>
            <strong>智算驿站</strong>
            <span>Admin Console</span>
          </div>
        </div>
        <nav>
          <NavButton active={view === "dashboard"} onClick={() => refresh("dashboard")} icon={<BarChart3 size={18} />}>经营看板</NavButton>
          <NavButton active={view === "systemHealth"} onClick={() => refresh("systemHealth")} icon={<ShieldCheck size={18} />}>可用性巡检</NavButton>
          <NavButton active={view === "users"} onClick={() => refresh("users")} icon={<Users size={18} />}>用户管理</NavButton>
          <NavButton active={view === "wallets"} onClick={() => refresh("wallets")} icon={<WalletCards size={18} />}>余额管理</NavButton>
          <NavButton active={view === "walletTransactions"} onClick={() => refresh("walletTransactions")} icon={<ReceiptText size={18} />}>余额流水</NavButton>
          <NavButton active={view === "reconciliation"} onClick={() => refresh("reconciliation")} icon={<Scale size={18} />}>账务对账</NavButton>
          <NavButton active={view === "sales"} onClick={() => refresh("sales")} icon={<TrendingUp size={18} />}>售出情况</NavButton>
          <NavButton active={view === "usages"} onClick={() => refresh("usages")} icon={<Activity size={18} />}>用量</NavButton>
          <NavButton active={view === "products"} onClick={() => refresh("products")} icon={<PackagePlus size={18} />}>商品</NavButton>
          <NavButton active={view === "orders"} onClick={() => refresh("orders")} icon={<KeyRound size={18} />}>订单</NavButton>
          <NavButton active={view === "rentals"} onClick={() => refresh("rentals")} icon={<ShieldCheck size={18} />}>租赁</NavButton>
          <NavButton active={view === "sub2"} onClick={() => refresh("sub2")} icon={<Activity size={18} />}>反代状态</NavButton>
          <NavButton active={view === "proxyRequests"} onClick={() => refresh("proxyRequests")} icon={<ScrollText size={18} />}>反代请求</NavButton>
          <NavButton active={view === "resources"} onClick={() => refresh("resources")} icon={<Boxes size={18} />}>共享资源</NavButton>
          <NavButton active={view === "settlements"} onClick={() => refresh("settlements")} icon={<CircleDollarSign size={18} />}>结算</NavButton>
          <NavButton active={view === "withdrawals"} onClick={() => refresh("withdrawals")} icon={<WalletCards size={18} />}>提现</NavButton>
          <NavButton active={view === "audit"} onClick={() => refresh("audit")} icon={<ScrollText size={18} />}>审计</NavButton>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar glass-panel">
          <div>
            <span className="eyebrow">Operations</span>
            <h1>{titleFor(view)}</h1>
            <p>集中管理所有用户、共享资源、余额、销售订单和 Sub2API 租赁通道。</p>
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => refresh()}><RefreshCw size={18} />刷新</button>
            <button className="ghost" onClick={() => { clearAdminToken(); setLoggedIn(false); }}>退出</button>
          </div>
        </header>

        {message && <div className="notice glass-panel">{message}</div>}
        {view === "dashboard" && <DashboardView dashboard={dashboard} />}
        {view === "systemHealth" && (
          <SystemHealthView
            health={systemHealth}
            maintenance={systemMaintenance}
            onRefresh={() => refresh("systemHealth")}
            onRunMaintenance={runSystemMaintenance}
          />
        )}
        {view === "users" && (
          <UsersView
            users={users}
            selectedUser={selectedUser}
            query={listQueries.users}
            meta={listMeta.users}
            onCreate={createUser}
            onStatus={setUserStatus}
            onRoles={setUserRoles}
            onDetail={openUserDetail}
            onCloseDetail={() => setSelectedUser(null)}
            onDraft={(patch) => updateListDraft("users", patch)}
            onFilter={(event) => submitListFilters("users", event)}
            onClear={() => clearListFilters("users")}
            onPage={(page) => changeListPage("users", page)}
            onExport={() => exportFilteredList("users")}
          />
        )}
        {view === "wallets" && (
          <WalletsView
            wallets={wallets}
            users={users}
            query={listQueries.wallets}
            meta={listMeta.wallets}
            onAdjust={adjustWallet}
            onDraft={(patch) => updateListDraft("wallets", patch)}
            onFilter={(event) => submitListFilters("wallets", event)}
            onClear={() => clearListFilters("wallets")}
            onPage={(page) => changeListPage("wallets", page)}
            onExport={() => exportFilteredList("wallets")}
          />
        )}
        {view === "walletTransactions" && (
          <WalletTransactionsView
            transactions={walletTransactions}
            query={listQueries.walletTransactions}
            meta={listMeta.walletTransactions}
            onDraft={(patch) => updateListDraft("walletTransactions", patch)}
            onFilter={(event) => submitListFilters("walletTransactions", event)}
            onClear={() => clearListFilters("walletTransactions")}
            onPage={(page) => changeListPage("walletTransactions", page)}
            onExport={() => exportFilteredList("walletTransactions")}
          />
        )}
        {view === "reconciliation" && (
          <ReconciliationView
            reconciliation={reconciliation}
            onRefresh={() => refresh("reconciliation")}
          />
        )}
        {view === "sales" && (
          <SalesView
            sales={sales}
            selectedOrder={selectedOrder}
            query={listQueries.sales}
            meta={listMeta.sales}
            onDetail={openOrderDetail}
            onCancel={cancelOrder}
            onRefund={refundOrder}
            onCloseDetail={() => setSelectedOrder(null)}
            onDraft={(patch) => updateListDraft("sales", patch)}
            onFilter={(event) => submitListFilters("sales", event)}
            onClear={() => clearListFilters("sales")}
            onPage={(page) => changeListPage("sales", page)}
            onExport={() => exportFilteredList("sales")}
          />
        )}
        {view === "usages" && (
          <UsagesView
            usages={usages}
            summary={usageSummary}
            syncState={usageSyncState}
            query={listQueries.usages}
            meta={listMeta.usages}
            onSync={syncSub2Usages}
            onDraft={(patch) => updateListDraft("usages", patch)}
            onFilter={(event) => submitListFilters("usages", event)}
            onClear={() => clearListFilters("usages")}
            onPage={(page) => changeListPage("usages", page)}
            onExport={() => exportFilteredList("usages")}
          />
        )}
        {view === "products" && (
          <ProductsView
            products={products}
            query={listQueries.products}
            meta={listMeta.products}
            onCreate={createProduct}
            onProductStatus={setProductStatus}
            onCreatePrice={createProductPrice}
            onPriceStatus={setProductPriceStatus}
            onDraft={(patch) => updateListDraft("products", patch)}
            onFilter={(event) => submitListFilters("products", event)}
            onClear={() => clearListFilters("products")}
            onPage={(page) => changeListPage("products", page)}
            onExport={() => exportFilteredList("products")}
          />
        )}
        {view === "orders" && (
          <OrdersView
            orders={orders}
            selectedOrder={selectedOrder}
            query={listQueries.orders}
            meta={listMeta.orders}
            onDetail={openOrderDetail}
            onCancel={cancelOrder}
            onRefund={refundOrder}
            onCloseDetail={() => setSelectedOrder(null)}
            onDraft={(patch) => updateListDraft("orders", patch)}
            onFilter={(event) => submitListFilters("orders", event)}
            onClear={() => clearListFilters("orders")}
            onPage={(page) => changeListPage("orders", page)}
            onExport={() => exportFilteredList("orders")}
          />
        )}
        {view === "rentals" && (
          <RentalsView
            rentals={rentals}
            query={listQueries.rentals}
            meta={listMeta.rentals}
            onRentalStatus={setRentalStatus}
            onUpdateLimits={updateRentalLimits}
            onApiKeyStatus={setApiKeyStatus}
            onRotateKey={rotateRentalKey}
            onExpireOverdue={expireOverdueRentals}
            onDraft={(patch) => updateListDraft("rentals", patch)}
            onFilter={(event) => submitListFilters("rentals", event)}
            onClear={() => clearListFilters("rentals")}
            onPage={(page) => changeListPage("rentals", page)}
            onExport={() => exportFilteredList("rentals")}
          />
        )}
        {view === "sub2" && (
          <Sub2StatusView
            status={sub2Status}
            tests={sub2Tests}
            smoke={sub2Smoke}
            bindings={sub2Bindings}
            onRefreshAccount={refreshSub2Account}
            onTestAccount={testSub2Account}
            onSmokeTest={runSub2SmokeTest}
            onCheckBindings={checkSub2Bindings}
            onRepairBindings={repairSub2Bindings}
            onApplyRefreshToken={applySub2RefreshToken}
          />
        )}
        {view === "proxyRequests" && (
          <ProxyRequestsView
            logs={proxyRequests}
            query={listQueries.proxyRequests}
            meta={listMeta.proxyRequests}
            onDraft={(patch) => updateListDraft("proxyRequests", patch)}
            onFilter={(event) => submitListFilters("proxyRequests", event)}
            onClear={() => clearListFilters("proxyRequests")}
            onPage={(page) => changeListPage("proxyRequests", page)}
            onExport={() => exportFilteredList("proxyRequests")}
          />
        )}
        {view === "resources" && (
          <ResourcesView
            resources={resources}
            selectedResource={selectedResource}
            query={listQueries.resources}
            meta={listMeta.resources}
            onCreate={createResource}
            onStatus={setResourceStatus}
            onTest={testResource}
            onDetail={openResourceDetail}
            onCloseDetail={() => setSelectedResource(null)}
            onDraft={(patch) => updateListDraft("resources", patch)}
            onFilter={(event) => submitListFilters("resources", event)}
            onClear={() => clearListFilters("resources")}
            onPage={(page) => changeListPage("resources", page)}
            onExport={() => exportFilteredList("resources")}
          />
        )}
        {view === "settlements" && (
          <SettlementsView
            settlements={settlements}
            query={listQueries.settlements}
            meta={listMeta.settlements}
            onReleaseAvailable={releaseAvailableSettlements}
            onDraft={(patch) => updateListDraft("settlements", patch)}
            onFilter={(event) => submitListFilters("settlements", event)}
            onClear={() => clearListFilters("settlements")}
            onPage={(page) => changeListPage("settlements", page)}
            onExport={() => exportFilteredList("settlements")}
          />
        )}
        {view === "withdrawals" && (
          <WithdrawalsView
            withdrawals={withdrawals}
            summary={withdrawalSummary}
            query={listQueries.withdrawals}
            meta={listMeta.withdrawals}
            onCreate={createWithdrawal}
            onStatus={setWithdrawalStatus}
            onDraft={(patch) => updateListDraft("withdrawals", patch)}
            onFilter={(event) => submitListFilters("withdrawals", event)}
            onClear={() => clearListFilters("withdrawals")}
            onPage={(page) => changeListPage("withdrawals", page)}
            onExport={() => exportFilteredList("withdrawals")}
          />
        )}
        {view === "audit" && (
          <AuditLogsView
            logs={auditLogs}
            query={listQueries.audit}
            meta={listMeta.audit}
            onDraft={(patch) => updateListDraft("audit", patch)}
            onFilter={(event) => submitListFilters("audit", event)}
            onClear={() => clearListFilters("audit")}
            onPage={(page) => changeListPage("audit", page)}
            onExport={() => exportFilteredList("audit")}
          />
        )}
      </section>
    </main>
  );
}

interface ManagedListProps {
  query: ListQueryState;
  meta: PageMeta;
  onDraft: (patch: Partial<ListQueryState>) => void;
  onFilter: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  onPage: (page: number) => void;
  onExport?: () => void;
}

function DashboardView({ dashboard }: { dashboard: Dashboard | null }) {
  const cards = [
    { label: "用户数", value: dashboard?.users ?? 0, icon: <Users size={20} /> },
    { label: "有效租赁", value: dashboard?.activeRentals ?? 0, icon: <KeyRound size={20} /> },
    { label: "在线资源", value: dashboard?.onlineResources ?? 0, icon: <Boxes size={20} /> },
    { label: "售出金额", value: money(dashboard?.paidOrderAmount), icon: <TrendingUp size={20} /> },
    { label: "可用余额", value: money(dashboard?.walletAvailable), icon: <WalletCards size={20} /> },
    { label: "累计充值", value: money(dashboard?.totalRecharged), icon: <CircleDollarSign size={20} /> },
    { label: "累计消费", value: money(dashboard?.totalSpent), icon: <BarChart3 size={20} /> },
    { label: "供给收益", value: money(dashboard?.supplierIncome), icon: <ShieldCheck size={20} /> }
  ];

  return (
    <>
      <section className="cards">
        {cards.map((card) => (
          <div className="metric-card" key={card.label}>
            <div className="metric-icon">{card.icon}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </section>
      <section className="content-grid">
        <div className="panel glass-panel">
          <span className="eyebrow">Settlement</span>
          <h2>经营摘要</h2>
          <table>
            <tbody>
              <tr><td>待提现</td><td>{dashboard?.pendingWithdrawals ?? 0}</td></tr>
              <tr><td>订单数</td><td>{dashboard?.paidOrderCount ?? 0}</td></tr>
              <tr><td>用量记录</td><td>{dashboard?.usageCount ?? 0}</td></tr>
              <tr><td>按量 GMV</td><td>{money(dashboard?.gmv)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel glass-panel">
          <span className="eyebrow">Risk Signal</span>
          <h2>系统状态</h2>
          <div className="health-row"><CheckCircle2 size={18} />业务 API 正常</div>
          <div className="health-row"><ShieldCheck size={18} />Sub2API 调度在线</div>
          <div className="health-row warning"><AlertTriangle size={18} />OAuth 与资源池仍需生产配置</div>
        </div>
      </section>
    </>
  );
}

function SystemHealthView({ health, maintenance, onRefresh, onRunMaintenance }: {
  health: SystemHealthResult | null;
  maintenance: SystemMaintenanceResult | null;
  onRefresh: () => void;
  onRunMaintenance: () => void;
}) {
  const checks = health?.checks ?? [];
  return (
    <section className="stack">
      <div className="panel glass-panel export-strip">
        <div>
          <span className="eyebrow">System health</span>
          <div className={health?.status === "ok" ? "health-row" : "health-row warning"}>
            {health?.status === "ok" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <strong>{health ? healthStatusText(health.status) : "等待巡检"}</strong>
          </div>
          {health && <small>检查时间 {dateTime(health.checkedAt)}</small>}
        </div>
        <div className="row-actions">
          <button className="secondary" onClick={onRefresh}><RefreshCw size={16} />重新巡检</button>
          <button className="secondary" onClick={onRunMaintenance}><ShieldCheck size={16} />运行安全维护</button>
        </div>
      </div>
      {maintenance && (
        <div className="panel glass-panel">
          <span className="eyebrow">Last maintenance</span>
          <div className="diagnostic-grid">
            <div><span>过期租赁</span><strong>{maintenance.actions.expireOverdueRentals?.expired ?? 0}</strong></div>
            <div><span>释放结算</span><strong>{maintenance.actions.releaseAvailableSettlements?.released ?? 0}</strong></div>
            <div><span>修复绑定</span><strong>{(maintenance.actions.repairSub2Bindings?.userBindingsUpserted ?? 0) + (maintenance.actions.repairSub2Bindings?.apiKeyBindingsUpserted ?? 0)}</strong></div>
            <div><span>清理自检</span><strong>{maintenance.actions.cleanupSmokeData?.rentalsClosed ?? 0}</strong></div>
            <div><span>自检 Key</span><strong>{maintenance.actions.cleanupSmokeData ? `${maintenance.actions.cleanupSmokeData.sub2KeysDisabled}/${maintenance.actions.cleanupSmokeData.sub2KeysDisableAttempted}` : "-"}</strong></div>
            <div><span>完成时间</span><strong>{dateTime(maintenance.finishedAt)}</strong></div>
          </div>
        </div>
      )}
      <section className="cards compact-cards">
        <Metric label="检查项" value={health?.summary.totalChecks ?? 0} />
        <Metric label="正常" value={health?.summary.ok ?? 0} />
        <Metric label="警告" value={health?.summary.warning ?? 0} />
        <Metric label="错误" value={health?.summary.error ?? 0} />
      </section>
      <TablePanel title="可用性检查项" count={checks.length} headers={["状态", "检查项", "结论", "关键指标"]}>
        {checks.map((check) => (
          <tr key={check.id}>
            <td><StatusPill status={healthStatusTone(check.status)} /></td>
            <td><strong>{check.label}</strong><small>{check.id}</small></td>
            <td><small>{check.summary}</small></td>
            <td><small>{healthMetricSummary(check.metrics)}</small></td>
          </tr>
        ))}
        {!health && (
          <tr>
            <td colSpan={4}><small>点击重新巡检开始读取系统健康信号。</small></td>
          </tr>
        )}
      </TablePanel>
    </section>
  );
}

function UsersView({ users, selectedUser, query, meta, onCreate, onStatus, onRoles, onDetail, onCloseDetail, onDraft, onFilter, onClear, onPage, onExport }: {
  users: UserRow[];
  selectedUser: UserDetailRow | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatus: (userId: string, status: UserStatus) => void;
  onRoles: (userId: string, roles: string[]) => void;
  onDetail: (userId: string) => void;
  onCloseDetail: () => void;
} & ManagedListProps) {
  return (
    <section className="stack">
      <form className="panel glass-panel inline-form" onSubmit={onCreate}>
        <span className="eyebrow">Create user</span>
        <input name="email" type="email" placeholder="邮箱" required />
        <input name="displayName" placeholder="显示名称" />
        <input name="password" type="password" placeholder="初始密码" minLength={8} required />
        <input name="roles" placeholder="角色，逗号分隔" defaultValue="buyer" />
        <button>创建用户</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="email / user id / role"
        statusOptions={userStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="用户管理" count={meta.total} headers={["邮箱", "角色", "状态", "余额", "订单/租赁", "操作"]}>
        {users.map((user) => (
          <tr key={user.id}>
            <td><strong>{user.email}</strong><small>{user.displayName ?? user.id}</small></td>
            <td>{user.roles.map((role) => role.role).join(", ")}</td>
            <td><StatusPill status={user.status} /></td>
            <td>{money(user.wallet?.availableBalance)}</td>
            <td>{user._count?.orders ?? 0} / {user._count?.rentals ?? 0}</td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onDetail(user.id)}>详情</button>
                <button className="secondary mini" onClick={() => onStatus(user.id, "active")}>启用</button>
                <button className="secondary mini" onClick={() => onStatus(user.id, "disabled")}>禁用</button>
                <button className="danger mini" onClick={() => onStatus(user.id, "banned")}>封禁</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedUser && <UserDetailPanel user={selectedUser} onRoles={onRoles} onClose={onCloseDetail} />}
    </section>
  );
}

function UserDetailPanel({ user, onRoles, onClose }: { user: UserDetailRow; onRoles: (userId: string, roles: string[]) => void; onClose: () => void }) {
  const transactions = user.wallet?.transactions ?? [];
  const orders = user.orders ?? [];
  const rentals = user.rentals ?? [];
  const resources = user.supplier?.resources ?? [];
  const withdrawals = user.supplier?.withdrawals ?? [];
  const identities = user.identities ?? [];
  const apiKeys = user.apiKeys ?? [];

  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">User Detail</span>
          <h2>{user.email}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={user.status} />
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>用户 ID</span><strong>{user.id}</strong></div>
        <div><span>角色</span><strong>{user.roles.map((role) => role.role).join(", ") || "-"}</strong></div>
        <div><span>可用余额</span><strong>{money(user.wallet?.availableBalance)}</strong></div>
        <div><span>累计消费</span><strong>{money(user.wallet?.totalSpent)}</strong></div>
        <div><span>订单 / 租赁</span><strong>{orders.length} / {rentals.length}</strong></div>
        <div><span>API Key</span><strong>{apiKeys.length}</strong></div>
        <div><span>供给资源</span><strong>{resources.length}</strong></div>
        <div><span>创建时间</span><strong>{dateTime(user.createdAt)}</strong></div>
      </div>

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const roles = String(form.get("roles") || "")
            .split(",")
            .map((role) => role.trim())
            .filter(Boolean);
          onRoles(user.id, roles);
        }}
      >
        <span className="eyebrow">Roles</span>
        <input name="roles" defaultValue={user.roles.map((role) => role.role).join(", ")} />
        <button>Update roles</button>
      </form>

      <section className="detail-grid">
        <DetailBlock title="最近钱包流水">
          <MiniTable headers={["类型", "金额", "余额后", "引用", "时间"]}>
            {transactions.slice(0, 8).map((transaction) => (
              <tr key={transaction.id}>
                <td><StatusPill status={transaction.type} /></td>
                <td>{money(transaction.amount)}</td>
                <td>{money(transaction.balanceAfter)}</td>
                <td><strong>{transaction.refType ?? "-"}</strong><small>{transaction.refId ?? "-"}</small></td>
                <td>{dateTime(transaction.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近订单">
          <MiniTable headers={["订单", "状态", "金额", "租赁", "时间"]}>
            {orders.slice(0, 8).map((order) => (
              <tr key={order.id}>
                <td><small>{order.id}</small></td>
                <td><StatusPill status={order.status} /></td>
                <td>{money(order.paidAmount)} / {money(order.totalAmount)}</td>
                <td>{order.rentals?.length ?? 0}</td>
                <td>{dateTime(order.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近租赁">
          <MiniTable headers={["租赁", "资源", "状态", "Endpoint", "到期"]}>
            {rentals.slice(0, 8).map((rental) => (
              <tr key={rental.id}>
                <td><small>{rental.id}</small></td>
                <td>{rental.product?.name ?? rental.resourceType}</td>
                <td><StatusPill status={rental.status} /></td>
                <td><small>{rental.endpointUrl ?? "-"}</small></td>
                <td>{dateTime(rental.endsAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="API Key">
          <MiniTable headers={["名称", "前缀", "状态", "最近使用", "创建"]}>
            {apiKeys.slice(0, 8).map((apiKey) => (
              <tr key={apiKey.id}>
                <td>{apiKey.name}</td>
                <td><small>{apiKey.keyPrefix}</small></td>
                <td><StatusPill status={apiKey.status} /></td>
                <td>{dateTime(apiKey.lastUsedAt)}</td>
                <td>{dateTime(apiKey.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="供给资源">
          <MiniTable headers={["资源", "状态", "等级", "Sub2 账号", "更新时间"]}>
            {resources.slice(0, 8).map((resource) => (
              <tr key={resource.id}>
                <td>{resource.resourceType}</td>
                <td><StatusPill status={resource.status} /></td>
                <td>{resource.level}</td>
                <td><small>{resource.sub2AccountId ?? "-"}</small></td>
                <td>{dateTime(resource.updatedAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="提现记录">
          <MiniTable headers={["金额", "状态", "引用", "备注", "创建"]}>
            {withdrawals.slice(0, 8).map((withdrawal) => (
              <tr key={withdrawal.id}>
                <td>{money(withdrawal.amount)}</td>
                <td><StatusPill status={withdrawal.status} /></td>
                <td><small>{withdrawal.payoutRef ?? "-"}</small></td>
                <td><small>{withdrawal.note ?? "-"}</small></td>
                <td>{dateTime(withdrawal.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="登录身份">
          <MiniTable headers={["Provider", "邮箱", "名称", "创建"]}>
            {identities.slice(0, 8).map((identity) => (
              <tr key={identity.id}>
                <td>{identity.provider}</td>
                <td><small>{identity.email ?? "-"}</small></td>
                <td>{identity.displayName ?? "-"}</td>
                <td>{dateTime(identity.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="detail-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MiniTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap compact-table">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function WalletsView({ wallets, users, query, meta, onAdjust, onDraft, onFilter, onClear, onPage, onExport }: {
  wallets: WalletRow[];
  users: UserRow[];
  onAdjust: (event: FormEvent<HTMLFormElement>) => void;
} & ManagedListProps) {
  const userOptions = useMemo(() => {
    const seen = new Set(wallets.map((wallet) => wallet.userId));
    return [...wallets.map((wallet) => ({ id: wallet.userId, email: wallet.user?.email ?? wallet.userId })), ...users.filter((user) => !seen.has(user.id)).map((user) => ({ id: user.id, email: user.email }))];
  }, [wallets, users]);

  return (
    <section className="stack">
      <form className="panel glass-panel inline-form" onSubmit={onAdjust}>
        <span className="eyebrow">Adjust balance</span>
        <select name="userId" required>
          <option value="">选择用户</option>
          {userOptions.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
        </select>
        <input name="amount" type="number" step="0.01" placeholder="调整金额，可为负数" required />
        <input name="note" placeholder="备注" />
        <button>调整余额</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="email / user id / wallet id"
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="余额管理" count={meta.total} headers={["用户", "可用", "冻结", "充值", "消费", "更新时间"]}>
        {wallets.map((wallet) => (
          <tr key={wallet.id}>
            <td><strong>{wallet.user?.email ?? wallet.userId}</strong><small>{wallet.userId}</small></td>
            <td>{money(wallet.availableBalance)}</td>
            <td>{money(wallet.frozenBalance)}</td>
            <td>{money(wallet.totalRecharged)}</td>
            <td>{money(wallet.totalSpent)}</td>
            <td>{dateTime(wallet.updatedAt)}</td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function WalletTransactionsView({ transactions, query, meta, onDraft, onFilter, onClear, onPage, onExport }: {
  transactions: WalletTransactionRow[];
} & ManagedListProps) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="email / tx id / ref / note"
        statusOptions={walletTransactionTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="余额流水" count={meta.total} headers={["用户", "类型", "金额", "余额后", "引用", "备注", "时间"]}>
        {transactions.map((transaction) => (
          <tr key={transaction.id}>
            <td><strong>{transaction.wallet?.user?.email ?? transaction.walletId}</strong><small>{transaction.id}</small></td>
            <td><StatusPill status={transaction.type} /></td>
            <td>{money(transaction.amount)}</td>
            <td>{money(transaction.balanceAfter)}</td>
            <td><strong>{transaction.refType ?? "-"}</strong><small>{transaction.refId ?? "-"}</small></td>
            <td><small>{transaction.note ?? "-"}</small></td>
            <td>{dateTime(transaction.createdAt)}</td>
          </tr>
        ))}
      </TablePanel>
    </>
  );
}

function ReconciliationView({ reconciliation, onRefresh }: {
  reconciliation: ReconciliationResult | null;
  onRefresh: () => void;
}) {
  const summary = reconciliation?.summary;
  const issues = reconciliation?.issues ?? [];
  return (
    <section className="stack">
      <div className="panel glass-panel export-strip">
        <div>
          <span className="eyebrow">Billing reconciliation</span>
          <div className={reconciliation?.ok ? "health-row" : "health-row warning"}>
            {reconciliation?.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <strong>{reconciliation ? (reconciliation.ok ? "账务一致" : "发现账务问题") : "等待巡检"}</strong>
          </div>
          {reconciliation && <small>扫描上限 {reconciliation.scanLimit}，检查时间 {dateTime(reconciliation.checkedAt)}</small>}
        </div>
        <button className="secondary" onClick={onRefresh}><RefreshCw size={16} />重新对账</button>
      </div>
      <section className="cards compact-cards">
        <Metric label="问题总数" value={summary?.totalIssues ?? 0} />
        <Metric label="缺少扣费流水" value={summary?.billedUsageMissingWalletTransactions ?? 0} />
        <Metric label="流水引用缺失" value={summary?.walletTransactionsMissingUsage ?? 0} />
        <Metric label="用量结算不平" value={summary?.usageSettlementMismatches ?? 0} />
        <Metric label="结算超分配" value={summary?.settlementOverallocated ?? 0} />
        <Metric label="提现分配不平" value={summary?.withdrawalAllocationMismatches ?? 0} />
      </section>
      <TablePanel title="账务问题明细" count={summary?.totalIssues ?? 0} headers={["级别", "类型", "引用", "金额", "期望/实际", "说明", "时间"]}>
        {issues.map((issue) => (
          <tr key={issue.id}>
            <td><StatusPill status={issue.severity} /></td>
            <td><strong>{issue.type}</strong></td>
            <td><strong>{issue.refType}</strong><small>{issue.refId}</small></td>
            <td>{issue.amount ? money(issue.amount) : "-"}</td>
            <td><strong>{issue.expected ? money(issue.expected) : "-"}</strong><small>{issue.actual ? money(issue.actual) : "-"}</small></td>
            <td><small>{issue.message}</small></td>
            <td>{dateTime(issue.createdAt)}</td>
          </tr>
        ))}
        {reconciliation && issues.length === 0 && (
          <tr>
            <td colSpan={7}><small>当前扫描范围内未发现账务一致性问题。</small></td>
          </tr>
        )}
        {!reconciliation && (
          <tr>
            <td colSpan={7}><small>点击重新对账开始扫描。</small></td>
          </tr>
        )}
      </TablePanel>
    </section>
  );
}

function SalesView({ sales, selectedOrder, query, meta, onDetail, onCancel, onRefund, onCloseDetail, onDraft, onFilter, onClear, onPage, onExport }: {
  sales: SalesData | null;
  selectedOrder: OrderDetailRow | null;
  onDetail: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onRefund: (orderId: string) => void;
  onCloseDetail: () => void;
} & ManagedListProps) {
  const orders = sales?.orders ?? [];
  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="订单数" value={sales?.summary.orderCount ?? meta.total} />
        <Metric label="订单金额" value={money(sales?.summary.totalAmount)} />
        <Metric label="已付金额" value={money(sales?.summary.paidAmount)} />
        <Metric label="按量收入" value={money(sales?.summary.usageCharge)} />
      </section>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="order / email / product / rental"
        statusOptions={orderStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <OrdersView
        orders={orders}
        title="售出订单"
        selectedOrder={selectedOrder}
        meta={meta}
        onDetail={onDetail}
        onCancel={onCancel}
        onRefund={onRefund}
        onCloseDetail={onCloseDetail}
      />
    </section>
  );
}

function UsagesView({ usages, summary, syncState, query, meta, onSync, onDraft, onFilter, onClear, onPage, onExport }: {
  usages: UsageRecordRow[];
  summary: AggregateSummary | null;
  syncState: UsageSyncStateResult | null;
  onSync: (event: FormEvent<HTMLFormElement>) => void;
} & ManagedListProps) {
  const state = syncState?.state;
  const runs = syncState?.runs ?? [];
  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="用量记录" value={summary?._count ?? meta.total} />
        <Metric label="买家计费" value={money(summary?._sum?.buyerCharge)} />
        <Metric label="供给收入" value={money(summary?._sum?.supplierIncome)} />
        <Metric label="Tokens" value={`${Number(summary?._sum?.inputUnits ?? 0).toFixed(0)} / ${Number(summary?._sum?.outputUnits ?? 0).toFixed(0)}`} />
      </section>
      <section className="panel glass-panel wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">Sub2 usage cursor</span>
            <h2>同步状态</h2>
          </div>
          <StatusPill status={state?.lastStatus ?? "idle"} />
        </div>
        <div className="diagnostic-grid">
          <div><span>Cursor</span><strong>{state?.cursor ?? "-"}</strong></div>
          <div><span>最近开始</span><strong>{dateTime(state?.lastStartedAt)}</strong></div>
          <div><span>最近完成</span><strong>{dateTime(state?.lastFinishedAt)}</strong></div>
          <div><span>最近结果</span><strong>{state ? `${state.lastImported}/${state.lastSkipped}/${state.lastUnmatched}` : "-"}</strong></div>
          <div><span>最近错误</span><strong>{state?.lastError ?? "-"}</strong></div>
        </div>
        {runs.length > 0 && (
          <MiniTable headers={["批次", "状态", "导入/跳过/未匹配", "Cursor", "时间"]}>
            {runs.slice(0, 5).map((run) => (
              <tr key={run.id}>
                <td><small>{run.id}</small></td>
                <td><StatusPill status={run.status} /></td>
                <td>{run.imported} / {run.skipped} / {run.unmatched}</td>
                <td><small>{run.cursorIn ?? "-"} → {run.cursorOut ?? "-"}</small></td>
                <td>{dateTime(run.finishedAt ?? run.startedAt)}</td>
              </tr>
            ))}
          </MiniTable>
        )}
      </section>
      <form className="panel glass-panel inline-form usage-sync-form" onSubmit={onSync}>
        <span className="eyebrow">Sub2 usage</span>
        <input name="cursor" placeholder="cursor，可选" />
        <button>同步用量</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="request / user / rental / model"
        statusOptions={usageStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="用量记录" count={meta.total} headers={["用户", "模型", "状态", "Tokens", "计费", "供给方", "时间"]}>
        {usages.map((usage) => (
          <tr key={usage.id}>
            <td>
              <strong>{usage.rental?.user?.email ?? usage.userId}</strong>
              <small>{usage.sub2RequestId}</small>
            </td>
            <td>
              <strong>{usage.model ?? "-"}</strong>
              <small>{usage.resourceType} / {usage.rental?.product?.name ?? usage.rentalId}</small>
            </td>
            <td><StatusPill status={usage.status} /></td>
            <td>{Number(usage.inputUnits).toFixed(0)} / {Number(usage.outputUnits).toFixed(0)}</td>
            <td>
              <strong>{money(usage.buyerCharge)}</strong>
              <small>API cost {money(usage.apiEquivalentCost)}</small>
            </td>
            <td>
              <strong>{money(usage.supplierIncome)}</strong>
              <small>{usage.supplierResource?.supplier?.user?.email ?? usage.supplierResource?.sub2AccountId ?? "-"}</small>
            </td>
            <td>{dateTime(usage.occurredAt)}</td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function ProductsView({ products, query, meta, onCreate, onProductStatus, onCreatePrice, onPriceStatus, onDraft, onFilter, onClear, onPage, onExport }: {
  products: ProductRow[];
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onProductStatus: (productId: string, status: string) => void;
  onCreatePrice: (event: FormEvent<HTMLFormElement>) => void;
  onPriceStatus: (priceId: string, status: string) => void;
} & ManagedListProps) {
  return (
    <section className="stack">
      <form className="panel glass-panel inline-form" onSubmit={onCreate}>
        <span className="eyebrow">Create product</span>
        <input name="name" placeholder="商品名称" required />
        <input name="description" placeholder="描述，可选" />
        <select name="resourceType" defaultValue="codex" required>
          {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
        </select>
        <select name="billingMode" defaultValue="monthly" required>
          {billingModeOptions.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select>
        <select name="status" defaultValue="draft" required>
          {productStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button>创建商品</button>
      </form>

      <form className="panel glass-panel inline-form product-price-form" onSubmit={onCreatePrice}>
        <span className="eyebrow">Create price</span>
        <select name="productId" required>
          <option value="">选择商品</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <input name="tierCode" placeholder="tier_code" pattern="[a-z0-9_-]+" required />
        <input name="displayName" placeholder="价格名称" required />
        <input name="fixedPrice" type="number" step="0.01" min={0.01} placeholder="固定价格" required />
        <input name="durationDays" type="number" min={1} placeholder="租期天数，可选" />
        <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={1} placeholder="并发" required />
        <input name="requestLimit" type="number" min={1} placeholder="请求数，可选" />
        <input name="spendLimit" type="number" step="0.000001" min={0.000001} placeholder="消费上限，可选" />
        <input name="discountRate" type="number" step="0.01" min={0} max={1} defaultValue={0.2} placeholder="折扣率" required />
        <input name="tierMultiplier" type="number" step="0.01" min={0.01} defaultValue={1} placeholder="倍率" required />
        <select name="status" defaultValue="active" required>
          {productStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button>创建价格</button>
      </form>

      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="product / tier / resource"
        statusOptions={productStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />

      <TablePanel title="商品与价格" count={meta.total} headers={["商品", "资源", "状态", "价格", "订单/租赁", "操作"]}>
        {products.map((product) => (
          <tr key={product.id}>
            <td><strong>{product.name}</strong><small>{product.description ?? product.id}</small></td>
            <td>{product.resourceType} / {product.billingMode}</td>
            <td><StatusPill status={product.status} /></td>
            <td>
              {(product.prices ?? []).map((price) => (
                <div className="price-line" key={price.id}>
                  <strong>{price.displayName} / {money(price.fixedPrice)}</strong>
                  <small>{price.tierCode} / {price.durationDays ?? "-"}d / 并发 {price.maxConcurrency} / 请求 {price.requestLimit ?? "-"} / 消费 {price.spendLimit ?? "-"}</small>
                  <div className="row-actions">
                    <StatusPill status={price.status} />
                    <button className="secondary mini" onClick={() => onPriceStatus(price.id, "active")}>启用</button>
                    <button className="secondary mini" onClick={() => onPriceStatus(price.id, "offline")}>下线</button>
                  </div>
                </div>
              ))}
            </td>
            <td>{product._count?.orders ?? 0} / {product._count?.rentals ?? 0}</td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onProductStatus(product.id, "draft")}>草稿</button>
                <button className="secondary mini" onClick={() => onProductStatus(product.id, "active")}>上架</button>
                <button className="danger mini" onClick={() => onProductStatus(product.id, "offline")}>下线</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function OrdersView({ orders, title = "订单列表", selectedOrder, query, meta, onDetail, onCancel, onRefund, onCloseDetail, onDraft, onFilter, onClear, onPage, onExport }: {
  orders: OrderRow[];
  title?: string;
  selectedOrder?: OrderDetailRow | null;
  onDetail?: (orderId: string) => void;
  onCancel?: (orderId: string) => void;
  onRefund?: (orderId: string) => void;
  onCloseDetail?: () => void;
} & Partial<ManagedListProps>) {
  return (
    <>
      {query && meta && onDraft && onFilter && onClear && onPage && (
        <ListControls
          query={query}
          meta={meta}
          searchPlaceholder="order id / email / payment ref"
          statusOptions={orderStatusOptions}
          onDraft={onDraft}
          onFilter={onFilter}
          onClear={onClear}
          onPage={onPage}
          onExport={onExport}
        />
      )}
      <TablePanel title={title} count={meta?.total ?? orders.length} headers={["用户", "状态", "金额", "租赁", "创建时间", "操作"]}>
        {orders.map((order) => (
          <tr key={order.id}>
            <td><strong>{order.user?.email ?? "-"}</strong><small>{order.id}</small></td>
            <td><StatusPill status={order.status} /></td>
            <td>{money(order.paidAmount)} / {money(order.totalAmount)}</td>
            <td>{order.rentals?.length ?? 0}</td>
            <td>{dateTime(order.createdAt)}</td>
            <td>
              <div className="row-actions">
                {onDetail && <button className="secondary mini" onClick={() => onDetail(order.id)}>详情</button>}
                {onCancel && <button className="secondary mini" onClick={() => onCancel(order.id)}>取消</button>}
                {onRefund && <button className="danger mini" onClick={() => onRefund(order.id)}>退款</button>}
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedOrder && onCloseDetail && <OrderDetailPanel order={selectedOrder} onCancel={onCancel} onRefund={onRefund} onClose={onCloseDetail} />}
    </>
  );
}

function OrderDetailPanel({ order, onCancel, onRefund, onClose }: { order: OrderDetailRow; onCancel?: (orderId: string) => void; onRefund?: (orderId: string) => void; onClose: () => void }) {
  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Order Detail</span>
          <h2>{order.id}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={order.status} />
          {onCancel && <button className="secondary mini" onClick={() => onCancel(order.id)}>取消</button>}
          {onRefund && <button className="danger mini" onClick={() => onRefund(order.id)}>退款</button>}
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>用户</span><strong>{order.user?.email ?? "-"}</strong></div>
        <div><span>已付 / 应付</span><strong>{money(order.paidAmount)} / {money(order.totalAmount)}</strong></div>
        <div><span>币种</span><strong>{order.currency ?? "USD"}</strong></div>
        <div><span>支付引用</span><strong>{order.paymentRef ?? "-"}</strong></div>
        <div><span>订单项</span><strong>{order.items.length}</strong></div>
        <div><span>租赁</span><strong>{order.rentals.length}</strong></div>
        <div><span>创建时间</span><strong>{dateTime(order.createdAt)}</strong></div>
        <div><span>更新时间</span><strong>{dateTime(order.updatedAt)}</strong></div>
      </div>

      <section className="detail-grid">
        <DetailBlock title="状态历史">
          <MiniTable headers={["从", "到", "原因", "操作者", "Meta", "时间"]}>
            {(order.statusHistory ?? []).map((history) => (
              <tr key={history.id}>
                <td>{history.fromStatus ?? "-"}</td>
                <td><StatusPill status={history.toStatus} /></td>
                <td>{history.reason ?? "-"}</td>
                <td><small>{history.actorUserId ?? "-"}</small></td>
                <td><small>{auditSummary(history.meta)}</small></td>
                <td>{dateTime(history.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="订单项">
          <MiniTable headers={["商品", "资源", "数量", "金额", "价格 ID"]}>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.product?.name ?? item.productId}</strong><small>{item.productId}</small></td>
                <td>{item.product?.resourceType ?? "-"}</td>
                <td>{item.quantity}</td>
                <td>{money(item.amount)}</td>
                <td><small>{item.priceId ?? "-"}</small></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="租赁交付">
          <MiniTable headers={["租赁", "状态", "资源", "Endpoint", "Sub2 Key", "到期"]}>
            {order.rentals.map((rental) => (
              <tr key={rental.id}>
                <td><small>{rental.id}</small></td>
                <td><StatusPill status={rental.status} /></td>
                <td>{rental.product?.name ?? rental.resourceType}</td>
                <td><small>{rental.endpointUrl ?? "-"}</small></td>
                <td><small>{rental.sub2KeyId ?? "-"}</small></td>
                <td>{dateTime(rental.endsAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="租赁限制">
          <MiniTable headers={["租赁", "并发", "RPM", "TPM", "请求数", "消费上限", "剩余额度"]}>
            {order.rentals.map((rental) => (
              <tr key={rental.id}>
                <td><small>{rental.id}</small></td>
                <td>{rental.limits?.maxConcurrency ?? "-"}</td>
                <td>{rental.limits?.rpmLimit ?? "-"}</td>
                <td>{rental.limits?.tpmLimit ?? "-"}</td>
                <td>{rental.limits?.requestLimit ?? "-"}</td>
                <td>{rental.limits?.spendLimit ?? "-"}</td>
                <td>{rental.limits?.remainingSpend ?? "-"}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="API Key">
          <MiniTable headers={["租赁", "名称", "前缀", "状态", "最近使用", "创建"]}>
            {order.rentals.flatMap((rental) => (rental.apiKeys ?? []).map((apiKey) => (
              <tr key={apiKey.id}>
                <td><small>{rental.id}</small></td>
                <td>{apiKey.name}</td>
                <td><small>{apiKey.keyPrefix}</small></td>
                <td><StatusPill status={apiKey.status} /></td>
                <td>{dateTime(apiKey.lastUsedAt)}</td>
                <td>{dateTime(apiKey.createdAt)}</td>
              </tr>
            )))}
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function RentalsView({ rentals, query, meta, onRentalStatus, onUpdateLimits, onApiKeyStatus, onRotateKey, onExpireOverdue, onDraft, onFilter, onClear, onPage, onExport }: {
  rentals: RentalRow[];
  onRentalStatus: (rentalId: string, status: string) => void;
  onUpdateLimits: (event: FormEvent<HTMLFormElement>, rentalId: string) => void;
  onApiKeyStatus: (apiKeyId: string, status: string) => void;
  onRotateKey: (rentalId: string) => void;
  onExpireOverdue: () => void;
} & ManagedListProps) {
  return (
    <>
      <div className="panel glass-panel export-strip">
        <span className="eyebrow">Maintenance</span>
        <button className="secondary" onClick={onExpireOverdue}><RefreshCw size={16} />Expire overdue rentals</button>
      </div>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="rental id / email / endpoint"
        statusOptions={rentalStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="租赁通道" count={meta.total} headers={["用户", "资源", "状态", "限制", "Endpoint", "API Key", "到期", "操作"]}>
        {rentals.map((rental) => (
          <tr key={rental.id}>
            <td><strong>{rental.user?.email ?? "-"}</strong><small>{rental.id}</small></td>
            <td>{rental.product?.name ?? rental.resourceType}</td>
            <td><StatusPill status={rental.status} /></td>
            <td>
              <form className="limits-form" onSubmit={(event) => onUpdateLimits(event, rental.id)}>
                <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={rental.limits?.maxConcurrency ?? 1} aria-label="并发" />
                <input name="rpmLimit" type="number" min={1} defaultValue={rental.limits?.rpmLimit ?? ""} placeholder="RPM" aria-label="RPM" />
                <input name="tpmLimit" type="number" min={1} defaultValue={rental.limits?.tpmLimit ?? ""} placeholder="TPM" aria-label="TPM" />
                <input name="requestLimit" type="number" min={1} defaultValue={rental.limits?.requestLimit ?? ""} placeholder="请求" aria-label="请求数" />
                <input name="spendLimit" type="number" step="0.000001" min={0.000001} defaultValue={rental.limits?.spendLimit ?? ""} placeholder="消费" aria-label="消费上限" />
                <input name="remainingSpend" type="number" step="0.000001" min={0} defaultValue={rental.limits?.remainingSpend ?? ""} placeholder="剩余" aria-label="剩余额度" />
                <button type="submit" className="secondary mini">保存</button>
              </form>
            </td>
            <td>{rental.endpointUrl ?? "-"}</td>
            <td>
              {(rental.apiKeys ?? []).slice(0, 3).map((apiKey) => (
                <div className="key-line" key={apiKey.id}>
                  <strong>{apiKey.name}</strong>
                  <small>{apiKey.keyPrefix} / {dateTime(apiKey.lastUsedAt)}</small>
                  <div className="row-actions">
                    <StatusPill status={apiKey.status} />
                    <button type="button" className="secondary mini" onClick={() => onApiKeyStatus(apiKey.id, "active")}>Key 启用</button>
                    <button type="button" className="danger mini" onClick={() => onApiKeyStatus(apiKey.id, "inactive")}>Key 停用</button>
                  </div>
                </div>
              ))}
            </td>
            <td>{dateTime(rental.endsAt)}</td>
            <td>
              <div className="row-actions">
                <button type="button" className="secondary mini" onClick={() => onRotateKey(rental.id)}>Rotate Key</button>
                <button type="button" className="secondary mini" onClick={() => onRentalStatus(rental.id, "active")}>恢复</button>
                <button type="button" className="secondary mini" onClick={() => onRentalStatus(rental.id, "suspended")}>暂停</button>
                <button type="button" className="danger mini" onClick={() => onRentalStatus(rental.id, "closed")}>关闭</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </>
  );
}

function Sub2StatusView({ status, tests, smoke, bindings, onRefreshAccount, onTestAccount, onSmokeTest, onCheckBindings, onRepairBindings, onApplyRefreshToken }: {
  status: Sub2Status | null;
  tests: Record<number, Sub2AccountTestResult>;
  smoke: Sub2ProxySmokeTestResult | null;
  bindings: Sub2BindingReconciliationResult | null;
  onRefreshAccount: (accountId: number) => void;
  onTestAccount: (accountId: number) => void;
  onSmokeTest: () => void;
  onCheckBindings: () => void;
  onRepairBindings: () => void;
  onApplyRefreshToken: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const accounts = status?.accounts ?? [];
  const groupAccounts = status?.defaultGroupId
    ? accounts.filter((account) => account.platform === "openai" && account.groupIds.includes(status.defaultGroupId!))
    : [];
  const activeAccounts = groupAccounts.filter((account) => account.status === "active");

  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="网关健康" value={status?.gatewayReachable ? "正常" : "异常"} />
        <Metric label="默认分组" value={status?.openAiGroup ? `${status.openAiGroup.name} #${status.openAiGroup.id}` : "-"} />
        <Metric label="可用上游" value={`${activeAccounts.length}/${groupAccounts.length}`} />
        <Metric label="反代状态" value={status?.ready ? "可用" : "阻断"} />
      </section>
      <div className="panel glass-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Codex Proxy</span>
            <h2>OpenAI/Codex 反代诊断</h2>
          </div>
          <div className="row-actions">
            <StatusPill status={status?.ready ? "active" : "failed"} />
            <button className="secondary mini" onClick={onSmokeTest}>端到端自检</button>
          </div>
        </div>
        <div className="diagnostic-grid">
          <div><span>Sub2API</span><strong>{status?.baseUrl ?? "-"}</strong></div>
          <div><span>Endpoint</span><strong>{status?.publicEndpoint ?? "-"}</strong></div>
          <div><span>检查时间</span><strong>{dateTime(status?.checkedAt)}</strong></div>
          <div><span>阻断原因</span><strong>{status?.blockingReasons.length ? status.blockingReasons.join(", ") : "none"}</strong></div>
        </div>
        {smoke && (
          <div className="diagnostic-grid">
            <div><span>自检模型</span><strong>{smoke.model}</strong></div>
            <div><span>临时 Key</span><strong>{smoke.keyDisabled ? "已禁用" : "未清理"}</strong></div>
            <div><span>Models</span><strong>{smoke.models.ok ? `通过 / ${smoke.models.modelCount}` : `失败 / HTTP ${smoke.models.statusCode}`}</strong></div>
            <div><span>Responses</span><strong>{smoke.responses.ok ? "通过" : smoke.responses.errorMessage ?? smoke.responses.errorType ?? `HTTP ${smoke.responses.statusCode}`}</strong></div>
            <div><span>本地代理</span><strong>{smoke.localProxy?.ok ? "通过" : "失败"}</strong></div>
            <div><span>代理日志</span><strong>{smoke.localProxy?.proxyRequestLogCount ?? 0}</strong></div>
            <div><span>本地清理</span><strong>{smoke.localProxy?.apiKeyDeactivated && smoke.localProxy.rentalClosed && smoke.localProxy.orderClosed && smoke.localProxy.walletReset ? "完成" : "待复查"}</strong></div>
          </div>
        )}
      </div>
      <div className="panel glass-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Object mapping</span>
            <h2>Sub2 绑定巡检</h2>
          </div>
          <div className="row-actions">
            <StatusPill status={bindings?.ok ? "active" : "warning"} />
            <button className="secondary mini" onClick={onCheckBindings}>巡检绑定</button>
            <button className="secondary mini" onClick={onRepairBindings}>修复绑定</button>
          </div>
        </div>
        <div className="diagnostic-grid">
          <div><span>租赁扫描</span><strong>{bindings?.summary.rentalsScanned ?? "-"}</strong></div>
          <div><span>绑定扫描</span><strong>{bindings?.summary.bindingsScanned ?? "-"}</strong></div>
          <div><span>问题数</span><strong>{bindings?.summary.totalIssues ?? "-"}</strong></div>
          <div><span>检查时间</span><strong>{dateTime(bindings?.checkedAt)}</strong></div>
        </div>
        {bindings && bindings.issues.length > 0 && (
          <div className="compact-table table-wrap">
            <table>
              <thead><tr><th>类型</th><th>租赁</th><th>期望/实际</th><th>说明</th></tr></thead>
              <tbody>
                {bindings.issues.slice(0, 8).map((issue) => (
                  <tr key={issue.id}>
                    <td><StatusPill status={issue.severity} /><small>{issue.type}</small></td>
                    <td><small>{issue.rentalId ?? "-"}</small></td>
                    <td><strong>{issue.expected ?? "-"}</strong><small>{issue.actual ?? "-"}</small></td>
                    <td><small>{issue.message}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <form className="panel glass-panel inline-form credential-form" onSubmit={onApplyRefreshToken}>
        <span className="eyebrow">Apply OpenAI Credentials</span>
        <select name="accountId" required>
          <option value="">选择上游账号</option>
          {accounts.filter((account) => account.platform === "openai").map((account) => (
            <option key={account.id} value={account.id}>#{account.id} {account.name}</option>
          ))}
        </select>
        <input name="refreshToken" type="password" placeholder="OpenAI refresh token" autoComplete="off" required />
        <input name="clientId" placeholder="client_id，可选" autoComplete="off" />
        <button>应用凭据</button>
      </form>
      <TablePanel title="OpenAI 上游账号" count={accounts.length} headers={["账号", "分组", "状态", "并发", "最近错误 / 测试结果", "操作"]}>
        {accounts.map((account) => (
          <tr key={account.id}>
            <td><strong>{account.name}</strong><small>#{account.id} / {account.platform} / {account.type}</small></td>
            <td>{account.groupNames.length ? account.groupNames.join(", ") : account.groupIds.join(", ") || "-"}</td>
            <td><StatusPill status={account.status} /></td>
            <td>{account.currentConcurrency ?? 0} / {account.concurrency ?? "-"}</td>
            <td>
              <small>{account.errorMessage ?? account.tempUnschedulableReason ?? "-"}</small>
              {tests[account.id] && (
                <small>
                  测试 {tests[account.id].ok ? "通过" : "失败"} / HTTP {tests[account.id].statusCode} / {testSummary(tests[account.id])}
                </small>
              )}
            </td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onTestAccount(account.id)}>测试账号</button>
                <button className="secondary mini" onClick={() => onRefreshAccount(account.id)}>刷新凭据</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function ProxyRequestsView({ logs, query, meta, onDraft, onFilter, onClear, onPage, onExport }: {
  logs: ProxyRequestLogRow[];
} & ManagedListProps) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="user / rental / key / path / request id"
        statusOptions={proxyStatusOptions}
        actionPlaceholder="error code contains"
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="OpenAI/Codex 反代请求" count={meta.total} headers={["用户", "租赁 / Key", "请求", "状态", "耗时", "用量估算", "来源", "时间"]}>
        {logs.map((log) => (
          <tr key={log.id}>
            <td><strong>{log.user?.email ?? log.userId ?? "-"}</strong><small>{log.requestId}</small></td>
            <td>
              <strong>{log.rental?.product?.name ?? log.rentalId ?? "-"}</strong>
              <small>{log.apiKey?.name ?? log.apiKeyPrefix ?? log.apiKeyId ?? "-"}</small>
            </td>
            <td><strong>{log.method}</strong><small>{log.path}</small></td>
            <td>
              <StatusPill status={proxyStatusTone(log.statusCode)} />
              <small>{log.statusCode ?? "-"} / upstream {log.upstreamStatusCode ?? "-"}</small>
              {log.errorCode && <small>{log.errorCode}</small>}
            </td>
            <td>{log.durationMs}ms</td>
            <td><strong>{log.estimatedInputTokens} tokens</strong><small>{log.requestBytes} bytes</small></td>
            <td><small>{log.ipAddress ?? "-"}</small><small>{log.userAgent ?? "-"}</small></td>
            <td>{dateTime(log.createdAt)}</td>
          </tr>
        ))}
      </TablePanel>
    </>
  );
}

function ResourcesView({ resources, selectedResource, query, meta, onCreate, onStatus, onTest, onDetail, onCloseDetail, onDraft, onFilter, onClear, onPage, onExport }: {
  resources: ResourceRow[];
  selectedResource: ResourceDetailRow | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatus: (resourceId: string, status: ResourceStatus) => void;
  onTest: (resourceId: string) => void;
  onDetail: (resourceId: string) => void;
  onCloseDetail: () => void;
} & ManagedListProps) {
  return (
    <>
      <form className="panel glass-panel inline-form resource-form" onSubmit={onCreate}>
        <span className="eyebrow">Create resource</span>
        <input name="supplierEmail" type="email" placeholder="供给方邮箱" required />
        <input name="displayName" placeholder="供给方显示名，可选" />
        <select name="resourceType" defaultValue="codex" required>
          {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
        </select>
        <select name="status" defaultValue="pending" required>
          {resourceStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select name="level" defaultValue="L0" required>
          {["L0", "L1", "L2", "L3", "L4"].map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
        <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={1} placeholder="并发" required />
        <input name="shareRate" type="number" step="0.01" min={0} max={1} defaultValue={0.7} placeholder="分成" required />
        <input name="reserveRatio" type="number" step="0.01" min={0} max={1} defaultValue={0.2} placeholder="保留比例" required />
        <input name="dailyCap" type="number" step="0.01" min={0} placeholder="日上限，可选" />
        <input name="sub2AccountId" placeholder="Sub2 账号 ID，可选" />
        <button>创建共享资源</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / resource id / sub2 account"
        statusOptions={resourceStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="共享资源池" count={meta.total} headers={["供给方", "资源", "状态", "等级", "Sub2 账号", "操作"]}>
        {resources.map((resource) => (
          <tr key={resource.id}>
            <td><strong>{resource.supplier?.user?.email ?? "-"}</strong><small>{resource.id}</small></td>
            <td>{resource.resourceType} / 并发 {resource.maxConcurrency}</td>
            <td><StatusPill status={resource.status} /></td>
            <td>{resource.level}</td>
            <td>{resource.sub2AccountId ?? "-"}</td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onDetail(resource.id)}>详情</button>
                <button className="secondary mini" onClick={() => onTest(resource.id)}>测试</button>
                <button className="secondary mini" onClick={() => onStatus(resource.id, "online")}>上线</button>
                <button className="secondary mini" onClick={() => onStatus(resource.id, "paused")}>暂停</button>
                <button className="danger mini" onClick={() => onStatus(resource.id, "disabled")}>禁用</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedResource && <ResourceDetailPanel resource={selectedResource} onClose={onCloseDetail} />}
    </>
  );
}

function ResourceDetailPanel({ resource, onClose }: { resource: ResourceDetailRow; onClose: () => void }) {
  const usages = resource.usages ?? [];
  const settlements = resource.settlements ?? [];
  const usageCount = resource.usageSummary?._count ?? usages.length;
  const settlementCount = resource.settlementSummary?._count ?? settlements.length;

  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Resource Detail</span>
          <h2>{resource.resourceType} / {resource.id}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={resource.status} />
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>供给方</span><strong>{resource.supplier?.user?.email ?? "-"}</strong></div>
        <div><span>等级 / 并发</span><strong>{resource.level} / {resource.maxConcurrency}</strong></div>
        <div><span>Sub2 账号</span><strong>{resource.sub2AccountId ?? "-"}</strong></div>
        <div><span>分成 / 保留</span><strong>{resource.shareRate ?? "-"} / {resource.reserveRatio ?? "-"}</strong></div>
        <div><span>用量记录</span><strong>{usageCount}</strong></div>
        <div><span>买家计费</span><strong>{money(resource.usageSummary?._sum?.buyerCharge)}</strong></div>
        <div><span>供给收入</span><strong>{money(resource.usageSummary?._sum?.supplierIncome)}</strong></div>
        <div><span>结算金额</span><strong>{money(resource.settlementSummary?._sum?.amount)}</strong></div>
      </div>

      <section className="detail-grid">
        <DetailBlock title="资源配置">
          <MiniTable headers={["字段", "值"]}>
            <tr><td>资源类型</td><td>{resource.resourceType}</td></tr>
            <tr><td>状态</td><td><StatusPill status={resource.status} /></td></tr>
            <tr><td>日上限</td><td>{money(resource.dailyCap)}</td></tr>
            <tr><td>最后检查</td><td>{dateTime(resource.lastCheckedAt)}</td></tr>
            <tr><td>创建时间</td><td>{dateTime(resource.createdAt)}</td></tr>
            <tr><td>更新时间</td><td>{dateTime(resource.updatedAt)}</td></tr>
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="供给方">
          <MiniTable headers={["字段", "值"]}>
            <tr><td>邮箱</td><td>{resource.supplier?.user?.email ?? "-"}</td></tr>
            <tr><td>显示名</td><td>{resource.supplier?.displayName ?? resource.supplier?.user?.displayName ?? "-"}</td></tr>
            <tr><td>状态</td><td>{resource.supplier?.status ?? "-"}</td></tr>
            <tr><td>默认分成</td><td>{resource.supplier?.defaultShareRate ?? "-"}</td></tr>
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近用量">
          <MiniTable headers={["请求", "用户", "模型", "状态", "买家计费", "供给收入", "时间"]}>
            {usages.slice(0, 10).map((usage) => (
              <tr key={usage.id}>
                <td><small>{usage.sub2RequestId}</small></td>
                <td><small>{usage.rental?.user?.email ?? "-"}</small></td>
                <td>{usage.model ?? "-"}</td>
                <td><StatusPill status={usage.status} /></td>
                <td>{money(usage.buyerCharge)}</td>
                <td>{money(usage.supplierIncome)}</td>
                <td>{dateTime(usage.occurredAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近结算">
          <MiniTable headers={["结算", "状态", "金额", "分成", "可用时间", "创建"]}>
            {settlements.slice(0, 10).map((settlement) => (
              <tr key={settlement.id}>
                <td><small>{settlement.id}</small></td>
                <td><StatusPill status={settlement.status} /></td>
                <td>{money(settlement.amount)}</td>
                <td>{settlement.shareRate}</td>
                <td>{dateTime(settlement.availableAt)}</td>
                <td>{dateTime(settlement.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function SettlementsView({ settlements, query, meta, onReleaseAvailable, onDraft, onFilter, onClear, onPage, onExport }: {
  settlements: SettlementRow[];
  onReleaseAvailable: () => void;
} & ManagedListProps) {
  return (
    <>
      <div className="panel glass-panel export-strip">
        <span className="eyebrow">Maintenance</span>
        <button className="secondary" onClick={onReleaseAvailable}><RefreshCw size={16} />Release available</button>
      </div>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / settlement id / usage id"
        statusOptions={settlementStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="供给方结算" count={meta.total} headers={["供给方", "金额", "占用/已提", "状态", "分成", "可用时间", "创建时间"]}>
        {settlements.map((settlement) => (
          <tr key={settlement.id}>
            <td><strong>{settlement.supplierResource?.supplier?.user?.email ?? "-"}</strong><small>{settlement.supplierResource?.resourceType ?? settlement.id}</small></td>
            <td>{money(settlement.amount)}</td>
            <td>{money(settlement.reservedAmount)} / {money(settlement.withdrawnAmount)}</td>
            <td><StatusPill status={settlement.status} /></td>
            <td>{settlement.shareRate}</td>
            <td>{dateTime(settlement.availableAt)}</td>
            <td>{dateTime(settlement.createdAt)}</td>
          </tr>
        ))}
      </TablePanel>
    </>
  );
}

function WithdrawalsView({ withdrawals, summary, query, meta, onCreate, onStatus, onDraft, onFilter, onClear, onPage, onExport }: {
  withdrawals: WithdrawalRow[];
  summary: AggregateSummary | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatus: (withdrawalId: string, status: string, payoutRef?: string) => void;
} & ManagedListProps) {
  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="提现记录" value={summary?._count ?? meta.total} />
        <Metric label="提现金额" value={money(summary?._sum?.amount)} />
        <Metric label="当前页" value={withdrawals.length} />
        <Metric label="待处理" value={withdrawals.filter((withdrawal) => withdrawal.status === "pending").length} />
      </section>
      <form className="panel glass-panel inline-form withdrawal-form" onSubmit={onCreate}>
        <span className="eyebrow">Create withdrawal</span>
        <input name="supplierEmail" type="email" placeholder="供给方邮箱" required />
        <input name="amount" type="number" step="0.01" min={0.01} placeholder="金额" required />
        <input name="currency" placeholder="币种" defaultValue="USD" />
        <select name="status" defaultValue="pending" required>
          {withdrawalStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <input name="payoutRef" placeholder="打款引用，可选" />
        <input name="note" placeholder="备注" />
        <button>录入提现</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / withdrawal / payout"
        statusOptions={withdrawalStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="提现管理" count={meta.total} headers={["供给方", "金额", "状态", "结算分配", "打款引用", "备注", "时间", "操作"]}>
        {withdrawals.map((withdrawal) => (
          <tr key={withdrawal.id}>
            <td><strong>{withdrawal.supplier?.user?.email ?? withdrawal.supplierId}</strong><small>{withdrawal.id}</small></td>
            <td>{money(withdrawal.amount)} {withdrawal.currency ?? "USD"}</td>
            <td><StatusPill status={withdrawal.status} /></td>
            <td><strong>{money(allocationAmount(withdrawal.settlements))}</strong><small>{withdrawal.settlements?.length ?? 0} records</small></td>
            <td><small>{withdrawal.payoutRef ?? "-"}</small></td>
            <td><small>{withdrawal.note ?? "-"}</small></td>
            <td>{dateTime(withdrawal.createdAt)}</td>
            <td>
              <div className="row-actions">
                {withdrawal.status === "pending" && (
                  <>
                    <button type="button" className="secondary mini" onClick={() => onStatus(withdrawal.id, "approved")}>通过</button>
                    <button type="button" className="secondary mini" onClick={() => onStatus(withdrawal.id, "rejected")}>驳回</button>
                    <button type="button" className="danger mini" onClick={() => onStatus(withdrawal.id, "cancelled")}>取消</button>
                  </>
                )}
                {withdrawal.status === "approved" && (
                  <>
                    <button type="button" className="secondary mini" onClick={() => onStatus(withdrawal.id, "paid", window.prompt("Payout reference") ?? undefined)}>打款</button>
                    <button type="button" className="danger mini" onClick={() => onStatus(withdrawal.id, "cancelled")}>取消</button>
                  </>
                )}
                {!["pending", "approved"].includes(withdrawal.status) && <small>-</small>}
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function AuditLogsView({ logs, query, meta, onDraft, onFilter, onClear, onPage, onExport }: { logs: AuditLogRow[] } & ManagedListProps) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="actor / object / ip"
        actionPlaceholder="action contains"
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="操作审计" count={meta.total} headers={["操作者", "动作", "对象", "结果摘要", "来源", "时间"]}>
        {logs.map((log) => (
          <tr key={log.id}>
            <td><strong>{log.actor?.email ?? "-"}</strong><small>{log.actor?.displayName ?? log.actor?.id ?? "-"}</small></td>
            <td>{log.action}</td>
            <td><strong>{log.objectType}</strong><small>{log.objectId ?? "-"}</small></td>
            <td><small>{auditSummary(log.after)}</small></td>
            <td><small>{log.ipAddress ?? "-"}</small><small>{log.userAgent ?? "-"}</small></td>
            <td>{dateTime(log.createdAt)}</td>
          </tr>
        ))}
      </TablePanel>
    </>
  );
}

function ListControls({ query, meta, searchPlaceholder, statusOptions = [], resourceTypeOptions = [], actionPlaceholder, onDraft, onFilter, onClear, onPage, onExport }: {
  query: ListQueryState;
  meta: PageMeta;
  searchPlaceholder?: string;
  statusOptions?: string[];
  resourceTypeOptions?: string[];
  actionPlaceholder?: string;
  onDraft: (patch: Partial<ListQueryState>) => void;
  onFilter: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  onPage: (page: number) => void;
  onExport?: () => void;
}) {
  return (
    <form className="panel glass-panel list-controls" onSubmit={onFilter}>
      <div className="filter-fields">
        <label className="input-with-icon">
          <Search size={16} />
          <input
            name="q"
            value={query.q}
            placeholder={searchPlaceholder ?? "search"}
            onChange={(event) => onDraft({ q: event.target.value })}
          />
        </label>
        {statusOptions.length > 0 && (
          <select name="status" value={query.status} onChange={(event) => onDraft({ status: event.target.value })}>
            <option value="">All status</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        )}
        {resourceTypeOptions.length > 0 && (
          <select name="resourceType" value={query.resourceType} onChange={(event) => onDraft({ resourceType: event.target.value })}>
            <option value="">All resources</option>
            {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
          </select>
        )}
        {actionPlaceholder && (
          <input
            name="action"
            value={query.action}
            placeholder={actionPlaceholder}
            onChange={(event) => onDraft({ action: event.target.value })}
          />
        )}
        <select name="pageSize" value={query.pageSize} onChange={(event) => onDraft({ pageSize: Number(event.target.value) })}>
          {[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size} / page</option>)}
        </select>
      </div>
      <div className="filter-actions">
        <button type="submit"><Filter size={16} />筛选</button>
        <button type="button" className="secondary" onClick={onClear}><X size={16} />清空</button>
        {onExport && <button type="button" className="secondary" onClick={onExport}><Download size={16} />导出全部筛选</button>}
        <div className="pager">
          <button type="button" className="secondary mini" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}><ChevronLeft size={15} /></button>
          <span>{meta.page} / {meta.totalPages}</span>
          <button type="button" className="secondary mini" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}><ChevronRight size={15} /></button>
        </div>
      </div>
    </form>
  );
}

function TablePanel({ title, count, headers, children }: {
  title: string;
  count: number;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="panel glass-panel wide">
      <div className="section-head">
        <div>
          <span className="eyebrow">Data Table</span>
          <h2>{title}</h2>
        </div>
        <strong>{count} 条</strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

function proxyStatusTone(statusCode?: number | null) {
  if (!statusCode) return "pending";
  if (statusCode < 300) return "active";
  if (statusCode < 500) return "warning";
  return "failed";
}

function healthStatusTone(status: SystemHealthResult["status"]) {
  if (status === "ok") return "active";
  if (status === "warning") return "warning";
  return "error";
}

function healthStatusText(status: SystemHealthResult["status"]) {
  if (status === "ok") return "系统可用";
  if (status === "warning") return "存在警告";
  return "存在阻断";
}

function healthMetricSummary(metrics?: Record<string, string | number | boolean | null>) {
  if (!metrics) return "-";
  const text = Object.entries(metrics)
    .map(([key, value]) => `${key}: ${value ?? "-"}`)
    .join(" / ");
  return text || "-";
}

function titleFor(view: View) {
  const map: Record<View, string> = {
    dashboard: "经营看板",
    systemHealth: "可用性巡检",
    users: "用户管理",
    wallets: "余额管理",
    walletTransactions: "余额流水",
    reconciliation: "账务对账",
    sales: "售出情况",
    usages: "用量记录",
    products: "商品管理",
    orders: "订单管理",
    rentals: "租赁通道",
    sub2: "反代状态",
    proxyRequests: "反代请求",
    resources: "共享资源",
    settlements: "结算管理",
    withdrawals: "提现管理",
    audit: "操作审计"
  };
  return map[view];
}

function createDefaultListQueries() {
  return Object.fromEntries(managedListViews.map((listView) => [listView, { ...defaultListQuery }])) as Record<ManagedListView, ListQueryState>;
}

function createDefaultListMeta() {
  return Object.fromEntries(managedListViews.map((listView) => [listView, { ...defaultPageMeta }])) as Record<ManagedListView, PageMeta>;
}

function buildListUrl(path: string, query: ListQueryState) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.resourceType) params.set("resourceType", query.resourceType);
  if (query.action) params.set("action", query.action);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return `${path}?${params.toString()}`;
}

function optionalFormString(form: FormData, name: string) {
  const value = String(form.get(name) || "").trim();
  return value || undefined;
}

function nullableFormNumber(form: FormData, name: string) {
  const value = String(form.get(name) || "").trim();
  return value || null;
}

type CsvCell = string | number | null | undefined;

function exportUsersCsv(rows: UserRow[], scope = "current-page") {
  downloadCsv(`users-${scope}`, ["id", "email", "displayName", "status", "roles", "balance", "orders", "rentals", "createdAt"], rows.map((user) => [
    user.id,
    user.email,
    user.displayName,
    user.status,
    user.roles.map((role) => role.role).join("|"),
    user.wallet?.availableBalance,
    user._count?.orders,
    user._count?.rentals,
    user.createdAt
  ]));
}

function exportWalletsCsv(rows: WalletRow[], scope = "current-page") {
  downloadCsv(`wallets-${scope}`, ["walletId", "userId", "email", "available", "frozen", "recharged", "spent", "updatedAt"], rows.map((wallet) => [
    wallet.id,
    wallet.userId,
    wallet.user?.email,
    wallet.availableBalance,
    wallet.frozenBalance,
    wallet.totalRecharged,
    wallet.totalSpent,
    wallet.updatedAt
  ]));
}

function exportWalletTransactionsCsv(rows: WalletTransactionRow[], scope = "current-page") {
  downloadCsv(`wallet-transactions-${scope}`, ["id", "email", "walletId", "type", "amount", "balanceAfter", "currency", "refType", "refId", "note", "createdAt"], rows.map((transaction) => [
    transaction.id,
    transaction.wallet?.user?.email,
    transaction.walletId,
    transaction.type,
    transaction.amount,
    transaction.balanceAfter,
    transaction.currency,
    transaction.refType,
    transaction.refId,
    transaction.note,
    transaction.createdAt
  ]));
}

function exportUsagesCsv(rows: UsageRecordRow[], scope = "current-page") {
  downloadCsv(`usages-${scope}`, ["id", "sub2RequestId", "email", "rentalId", "resourceType", "model", "status", "inputUnits", "outputUnits", "apiEquivalentCost", "buyerCharge", "supplierIncome", "supplierEmail", "occurredAt"], rows.map((usage) => [
    usage.id,
    usage.sub2RequestId,
    usage.rental?.user?.email,
    usage.rentalId,
    usage.resourceType,
    usage.model,
    usage.status,
    usage.inputUnits,
    usage.outputUnits,
    usage.apiEquivalentCost,
    usage.buyerCharge,
    usage.supplierIncome,
    usage.supplierResource?.supplier?.user?.email,
    usage.occurredAt
  ]));
}

function exportProductsCsv(rows: ProductRow[], scope = "current-page") {
  downloadCsv(`products-${scope}`, ["id", "name", "resourceType", "billingMode", "status", "priceCount", "orders", "rentals", "updatedAt"], rows.map((product) => [
    product.id,
    product.name,
    product.resourceType,
    product.billingMode,
    product.status,
    product._count?.prices ?? product.prices?.length ?? 0,
    product._count?.orders,
    product._count?.rentals,
    product.updatedAt
  ]));
}

function exportOrdersCsv(rows: OrderRow[], filename = "orders", scope = "current-page") {
  downloadCsv(`${filename}-${scope}`, ["id", "email", "status", "paidAmount", "totalAmount", "rentals", "createdAt"], rows.map((order) => [
    order.id,
    order.user?.email,
    order.status,
    order.paidAmount,
    order.totalAmount,
    order.rentals?.length ?? 0,
    order.createdAt
  ]));
}

function exportRentalsCsv(rows: RentalRow[], scope = "current-page") {
  downloadCsv(`rentals-${scope}`, ["id", "email", "status", "resourceType", "product", "endpointUrl", "sub2KeyId", "apiKeys", "createdAt", "endsAt"], rows.map((rental) => [
    rental.id,
    rental.user?.email,
    rental.status,
    rental.resourceType,
    rental.product?.name,
    rental.endpointUrl,
    rental.sub2KeyId,
    (rental.apiKeys ?? []).map((apiKey) => `${apiKey.keyPrefix}:${apiKey.status}`).join("|"),
    rental.createdAt,
    rental.endsAt
  ]));
}

function exportResourcesCsv(rows: ResourceRow[], scope = "current-page") {
  downloadCsv(`resources-${scope}`, ["id", "supplierEmail", "resourceType", "status", "level", "maxConcurrency", "sub2AccountId", "updatedAt"], rows.map((resource) => [
    resource.id,
    resource.supplier?.user?.email,
    resource.resourceType,
    resource.status,
    resource.level,
    resource.maxConcurrency,
    resource.sub2AccountId,
    resource.updatedAt
  ]));
}

function exportSettlementsCsv(rows: SettlementRow[], scope = "current-page") {
  downloadCsv(`settlements-${scope}`, ["id", "supplierEmail", "resourceType", "amount", "status", "shareRate", "availableAt", "createdAt"], rows.map((settlement) => [
    settlement.id,
    settlement.supplierResource?.supplier?.user?.email,
    settlement.supplierResource?.resourceType,
    settlement.amount,
    settlement.status,
    settlement.shareRate,
    settlement.availableAt,
    settlement.createdAt
  ]));
}

function exportWithdrawalsCsv(rows: WithdrawalRow[], scope = "current-page") {
  downloadCsv(`withdrawals-${scope}`, ["id", "supplierEmail", "amount", "currency", "status", "payoutRef", "note", "createdAt", "updatedAt"], rows.map((withdrawal) => [
    withdrawal.id,
    withdrawal.supplier?.user?.email,
    withdrawal.amount,
    withdrawal.currency,
    withdrawal.status,
    withdrawal.payoutRef,
    withdrawal.note,
    withdrawal.createdAt,
    withdrawal.updatedAt
  ]));
}

function exportAuditLogsCsv(rows: AuditLogRow[], scope = "current-page") {
  downloadCsv(`audit-logs-${scope}`, ["id", "actorEmail", "action", "objectType", "objectId", "summary", "ipAddress", "userAgent", "createdAt"], rows.map((log) => [
    log.id,
    log.actor?.email,
    log.action,
    log.objectType,
    log.objectId,
    auditSummary(log.after),
    log.ipAddress,
    log.userAgent,
    log.createdAt
  ]));
}

function exportProxyRequestsCsv(rows: ProxyRequestLogRow[], scope = "current-page") {
  downloadCsv(`proxy-requests-${scope}`, ["id", "requestId", "email", "rentalId", "apiKeyPrefix", "method", "path", "statusCode", "upstreamStatusCode", "errorCode", "durationMs", "requestBytes", "estimatedInputTokens", "ipAddress", "userAgent", "createdAt"], rows.map((log) => [
    log.id,
    log.requestId,
    log.user?.email,
    log.rentalId,
    log.apiKey?.keyPrefix ?? log.apiKeyPrefix,
    log.method,
    log.path,
    log.statusCode,
    log.upstreamStatusCode,
    log.errorCode,
    log.durationMs,
    log.requestBytes,
    log.estimatedInputTokens,
    log.ipAddress,
    log.userAgent,
    log.createdAt
  ]));
}

function downloadCsv(filenameBase: string, headers: string[], rows: CsvCell[][]) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${filenameBase}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: CsvCell) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function money(value?: string | number | null) {
  const numberValue = Number(value ?? 0);
  return `$${numberValue.toFixed(2)}`;
}

function allocationAmount(settlements?: WithdrawalSettlementRow[]) {
  return settlements?.reduce((sum, settlement) => sum + Number(settlement.amount || 0), 0) ?? 0;
}

function testSummary(result: Sub2AccountTestResult) {
  const errorEvent = result.events.find((event) => event.type === "error" || typeof event.error === "string");
  const message = errorEvent?.error ?? errorEvent?.message ?? result.raw;
  return String(message || "-").slice(0, 180);
}

function smokeSummary(result: Sub2ProxySmokeTestResult) {
  if (!result.provisioning.ok) return result.provisioning.error ?? "开通临时 Key 失败";
  if (!result.models.ok) return result.models.error ?? `Models HTTP ${result.models.statusCode}`;
  if (!result.responses.ok) return result.responses.errorMessage ?? result.responses.errorType ?? `Responses HTTP ${result.responses.statusCode}`;
  if (!result.localProxy?.ok) {
    const cleanupOk = result.localProxy?.apiKeyDeactivated && result.localProxy.rentalClosed && result.localProxy.orderClosed && result.localProxy.walletReset;
    return cleanupOk ? `本地代理日志不足：${result.localProxy?.proxyRequestLogCount ?? 0}` : "本地 smoke 租赁清理失败";
  }
  if (!result.keyDisabled) return result.cleanupError ?? "临时 Key 清理失败";
  return "-";
}

function auditSummary(value: unknown) {
  if (!value) return "-";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

createRoot(document.getElementById("root")!).render(<App />);
