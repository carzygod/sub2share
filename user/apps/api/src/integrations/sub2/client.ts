import { createHash, randomUUID } from "node:crypto";
import { env, openAiProxyPublicEndpoint } from "../../config/env.js";

export interface CreateSub2KeyInput {
  buyerId: string;
  rentalId: string;
  name: string;
  resourceType: string;
  maxConcurrency: number;
  requestLimit?: number | null;
  spendLimit?: string | null;
}

export interface Sub2KeyResult {
  sub2UserId: string;
  sub2KeyId: string;
  apiKey: string;
  endpointUrl: string;
}

export interface Sub2UsageRecord {
  id: string;
  apiKeyId: string;
  upstreamAccountId?: string;
  resourceType: string;
  model?: string;
  inputUnits: string;
  outputUnits: string;
  apiEquivalentCost: string;
  occurredAt: string;
}

interface Sub2Envelope<T> {
  code: number;
  message: string;
  data: T;
}

interface Sub2UserDto {
  id: number;
  email: string;
  allowed_groups?: number[];
}

interface Sub2ApiKeyDto {
  id: number;
  user_id: number;
  key: string;
  name: string;
  status: string;
  group_id?: number | null;
}

interface Sub2UsageListDto {
  items?: unknown[];
  next_cursor?: string;
}

interface Sub2ListDto<T> {
  items?: T[];
}

interface Sub2GroupDto {
  id: number;
  name: string;
  platform?: string;
  status?: string;
}

interface Sub2AccountDto {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
  error_message?: string | null;
  credentials_status?: unknown;
  group_ids?: number[];
  groups?: Sub2GroupDto[];
  concurrency?: number;
  current_concurrency?: number;
  schedulable?: boolean;
  last_used_at?: string | null;
  rate_limited_at?: string | null;
  overload_until?: string | null;
  temp_unschedulable_until?: string | null;
  temp_unschedulable_reason?: string | null;
  updated_at?: string;
}

interface Sub2GatewayJsonProbe {
  ok: boolean;
  statusCode: number;
  bodyText: string;
  json?: Record<string, any>;
  error?: string | null;
}

export interface Sub2GatewayAccountStatus {
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

export interface Sub2GatewayStatus {
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
  accounts: Sub2GatewayAccountStatus[];
}

export interface Sub2GatewayAccountTestResult {
  ok: boolean;
  statusCode: number;
  testedAt: string;
  events: Record<string, unknown>[];
  raw: string;
}

export interface Sub2ProxySmokeTestResult {
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
}

export interface Sub2ApplyOpenAiRefreshTokenInput {
  refreshToken: string;
  clientId?: string;
  proxyId?: number;
}

export interface Sub2ApplyOpenAiRefreshTokenResult {
  ok: boolean;
  accountId: number;
  refreshed: boolean;
  applied: boolean;
  error?: string | null;
}

export type Sub2ApiErrorKind =
  | "authentication"
  | "parameter"
  | "resource"
  | "rate_limited"
  | "conflict"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_response"
  | "unknown";

export class Sub2ApiError extends Error {
  constructor(
    public readonly kind: Sub2ApiErrorKind,
    message: string,
    public readonly statusCode?: number,
    public readonly retryable = false,
    public readonly body?: string
  ) {
    super(message);
    this.name = "Sub2ApiError";
  }
}

const MANAGED_USER_GATEWAY_BALANCE = 100000000;
const ADMIN_SMOKE_BUYER_ID = "admin-sub2-proxy-smoke";

export class Sub2ApiClient {
  private readonly baseUrl = env.SUB2_BASE_URL.replace(/\/$/, "");
  private adminAccessToken?: string;
  private discoveredDefaultGroupId?: number | null;

  async createKey(input: CreateSub2KeyInput): Promise<Sub2KeyResult> {
    const managedUser = this.managedUser(input.buyerId);
    const groupId = await this.defaultGroupId();
    await this.ensureManagedUser(managedUser.email, managedUser.password, input.maxConcurrency, groupId);
    const accessToken = await this.loginManagedUser(managedUser.email, managedUser.password);
    const apiKey = this.generateBuyerApiKey();
    const body: Record<string, unknown> = {
      name: input.name,
      custom_key: apiKey,
      quota: input.spendLimit ? Number(input.spendLimit) : 0,
      expires_in_days: null,
      rate_limit_5h: 0,
      rate_limit_1d: 0,
      rate_limit_7d: 0
    };

    if (groupId) {
      body.group_id = groupId;
    }

    const response = await this.request<Sub2Envelope<Sub2ApiKeyDto>>(
      "/api/v1/keys",
      {
        method: "POST",
        body: JSON.stringify(body)
      },
      accessToken
    );

    return {
      sub2UserId: String(response.data.user_id),
      sub2KeyId: String(response.data.id),
      apiKey,
      endpointUrl: openAiProxyPublicEndpoint
    };
  }

  async disableKey(buyerId: string, keyId: string) {
    const token = await this.managedUserToken(buyerId);
    await this.request(
      `/api/v1/keys/${encodeURIComponent(keyId)}`,
      { method: "PUT", body: JSON.stringify({ status: "inactive" }) },
      token
    );
  }

  async enableKey(buyerId: string, keyId: string) {
    const token = await this.managedUserToken(buyerId);
    await this.request(
      `/api/v1/keys/${encodeURIComponent(keyId)}`,
      { method: "PUT", body: JSON.stringify({ status: "active" }) },
      token
    );
  }

  async fetchUsageSince(cursor?: string): Promise<{ records: Sub2UsageRecord[]; nextCursor?: string }> {
    const url = new URL(`${this.baseUrl}/api/v1/usage`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await this.fetchWithTimeout(url.toString(), { headers: this.headers(await this.adminToken()) });
    if (!response.ok) {
      throw await this.errorFromResponse(response, "Sub2 usage sync failed");
    }
    const envelope = await this.readJson<Sub2Envelope<Sub2UsageListDto>>(response);
    return {
      records: this.normalizeUsage(envelope.data.items ?? []),
      nextCursor: envelope.data.next_cursor
    };
  }

  async fetchGatewayStatus(): Promise<Sub2GatewayStatus> {
    const checkedAt = new Date().toISOString();
    const gatewayReachable = await this.isGatewayReachable();
    const groups = await this.fetchAdminGroups();
    const defaultGroup = this.resolveDefaultGroup(groups);
    const accounts = await this.fetchAdminAccounts();
    const accountStatuses = accounts.map((account) => this.toAccountStatus(account));
    const openAiAccounts = accountStatuses.filter(
      (account) => account.platform === "openai" && (!defaultGroup || account.groupIds.includes(defaultGroup.id))
    );
    const activeOpenAiAccounts = openAiAccounts.filter((account) => account.status === "active");
    const blockingReasons: string[] = [];

    if (!gatewayReachable) blockingReasons.push("sub2api_health_unreachable");
    if (!defaultGroup) blockingReasons.push("openai_group_missing");
    if (defaultGroup && defaultGroup.status !== "active") blockingReasons.push("openai_group_inactive");
    if (defaultGroup && openAiAccounts.length === 0) blockingReasons.push("openai_group_has_no_accounts");
    if (defaultGroup && activeOpenAiAccounts.length === 0) blockingReasons.push("openai_group_has_no_active_accounts");

    return {
      checkedAt,
      baseUrl: this.baseUrl,
      publicEndpoint: env.SUB2_PUBLIC_ENDPOINT,
      defaultGroupId: defaultGroup?.id,
      gatewayReachable,
      ready: blockingReasons.length === 0,
      blockingReasons,
      openAiGroup: defaultGroup
        ? { id: defaultGroup.id, name: defaultGroup.name, platform: defaultGroup.platform, status: defaultGroup.status }
        : undefined,
      accounts: accountStatuses
    };
  }

  async refreshAccount(accountId: number) {
    try {
      await this.request(
        `/api/v1/admin/accounts/${encodeURIComponent(String(accountId))}/refresh`,
        { method: "POST", body: JSON.stringify({}) },
        await this.adminToken()
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
      };
    }
  }

  async testAccount(accountId: number): Promise<Sub2GatewayAccountTestResult> {
    const testedAt = new Date().toISOString();
    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.set("accept", "text/event-stream");
    headers.set("authorization", `Bearer ${await this.adminToken()}`);

    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/admin/accounts/${encodeURIComponent(String(accountId))}/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    const raw = (this.redactSensitiveText(await response.text()) ?? "").slice(0, 3000);
    const events = this.parseSseEvents(raw);
    const hasErrorEvent = events.some((event) => {
      const type = String(event.type ?? "").toLowerCase();
      return type === "error" || typeof event.error === "string";
    });

    return {
      ok: response.ok && !hasErrorEvent,
      statusCode: response.status,
      testedAt,
      events,
      raw
    };
  }

  async runProxySmokeTest(model = env.SUB2_SMOKE_MODEL): Promise<Sub2ProxySmokeTestResult> {
    const checkedAt = new Date().toISOString();
    let sub2Key: Sub2KeyResult | undefined;
    let keyDisabled = false;
    let cleanupError: string | null | undefined;
    const failedModels: Sub2ProxySmokeTestResult["models"] = { ok: false, statusCode: 0, modelCount: 0, firstModel: null, error: "skipped" };
    const failedResponses: Sub2ProxySmokeTestResult["responses"] = { ok: false, statusCode: 0, responseId: null, responseStatus: null, errorType: null, errorMessage: "skipped" };

    try {
      sub2Key = await this.createKey({
        buyerId: ADMIN_SMOKE_BUYER_ID,
        rentalId: randomUUID(),
        name: `Admin proxy smoke ${checkedAt}`,
        resourceType: "codex",
        maxConcurrency: 1,
        requestLimit: null,
        spendLimit: null
      });
    } catch (error) {
      return {
        ok: false,
        checkedAt,
        model,
        gatewayBaseUrl: this.baseUrl,
        publicEndpoint: env.SUB2_PUBLIC_ENDPOINT,
        keyDisabled,
        provisioning: {
          ok: false,
          error: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
        },
        models: failedModels,
        responses: failedResponses
      };
    }

    let models = failedModels;
    let responses = failedResponses;

    try {
      const modelsProbe = await this.fetchGatewayJson("/v1/models", sub2Key.apiKey, { method: "GET" }, 30_000);
      const modelItems = Array.isArray(modelsProbe.json?.data) ? modelsProbe.json.data : [];
      models = {
        ok: modelsProbe.ok,
        statusCode: modelsProbe.statusCode,
        modelCount: modelItems.length,
        firstModel: modelItems[0]?.id ? String(modelItems[0].id) : null,
        error: modelsProbe.ok ? null : this.extractGatewayError(modelsProbe)
      };

      const responsesProbe = await this.fetchGatewayJson(
        "/v1/responses",
        sub2Key.apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            model,
            input: "Return exactly OK.",
            max_output_tokens: 8
          })
        },
        90_000
      );
      const gatewayError = this.gatewayErrorObject(responsesProbe.json);
      responses = {
        ok: responsesProbe.ok && !gatewayError,
        statusCode: responsesProbe.statusCode,
        responseId: responsesProbe.json?.id ? String(responsesProbe.json.id) : null,
        responseStatus: responsesProbe.json?.status ? String(responsesProbe.json.status) : null,
        errorType: gatewayError?.type ? String(gatewayError.type) : null,
        errorMessage: gatewayError?.message
          ? this.redactSensitiveText(String(gatewayError.message))
          : responsesProbe.ok ? null : this.extractGatewayError(responsesProbe)
      };
    } catch (error) {
      if (models === failedModels) {
        models = {
          ...failedModels,
          error: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
        };
      } else {
        responses = {
          ...failedResponses,
          errorMessage: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
        };
      }
    }

    try {
      try {
        await this.disableKey(ADMIN_SMOKE_BUYER_ID, sub2Key.sub2KeyId);
        keyDisabled = true;
      } catch (error) {
        cleanupError = this.redactSensitiveText(error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      cleanupError = this.redactSensitiveText(error instanceof Error ? error.message : String(error));
    }

    return {
      ok: models.ok && responses.ok && keyDisabled,
      checkedAt,
      model,
      gatewayBaseUrl: this.baseUrl,
      publicEndpoint: env.SUB2_PUBLIC_ENDPOINT,
      sub2UserId: sub2Key.sub2UserId,
      sub2KeyId: sub2Key.sub2KeyId,
      keyDisabled,
      cleanupError,
      provisioning: { ok: true },
      models,
      responses
    };
  }

  async applyOpenAiRefreshToken(
    accountId: number,
    input: Sub2ApplyOpenAiRefreshTokenInput
  ): Promise<Sub2ApplyOpenAiRefreshTokenResult> {
    let credentials: unknown;
    try {
      const response = await this.request<Sub2Envelope<unknown>>(
        "/api/v1/admin/openai/refresh-token",
        {
          method: "POST",
          body: JSON.stringify({
            refresh_token: input.refreshToken,
            proxy_id: input.proxyId,
            client_id: input.clientId
          })
        },
        await this.adminToken()
      );
      credentials = response.data;
    } catch (error) {
      return {
        ok: false,
        accountId,
        refreshed: false,
        applied: false,
        error: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
      };
    }

    try {
      await this.request(
        `/api/v1/admin/accounts/${encodeURIComponent(String(accountId))}/apply-oauth-credentials`,
        {
          method: "POST",
          body: JSON.stringify(credentials)
        },
        await this.adminToken()
      );
      return { ok: true, accountId, refreshed: true, applied: true };
    } catch (error) {
      return {
        ok: false,
        accountId,
        refreshed: true,
        applied: false,
        error: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
      };
    }
  }

  private async ensureManagedUser(email: string, password: string, concurrency: number, groupId?: number) {
    try {
      await this.request<Sub2Envelope<Sub2UserDto>>(
        "/api/v1/admin/users",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            username: email.split("@")[0],
            notes: "Managed by 智算驿站",
            balance: MANAGED_USER_GATEWAY_BALANCE,
            concurrency,
            rpm_limit: 0,
            allowed_groups: groupId ? [groupId] : []
          })
        },
        await this.adminToken()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("409") && !message.toLowerCase().includes("exist")) throw error;
      if (groupId) {
        await this.ensureExistingManagedUserGroup(email, concurrency, groupId);
      }
    }
  }

  private async ensureExistingManagedUserGroup(email: string, concurrency: number, groupId: number) {
    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new Error(`Sub2API managed user already exists but cannot be found: ${email}`);
    }

    const allowedGroups = Array.from(new Set([...(user.allowed_groups ?? []), groupId]));
    await this.request(
      `/api/v1/admin/users/${encodeURIComponent(String(user.id))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          balance: MANAGED_USER_GATEWAY_BALANCE,
          concurrency,
          rpm_limit: 0,
          allowed_groups: allowedGroups
        })
      },
      await this.adminToken()
    );
  }

  private async findUserByEmail(email: string) {
    const response = await this.request<Sub2Envelope<Sub2ListDto<Sub2UserDto>>>(
      `/api/v1/admin/users?search=${encodeURIComponent(email)}`,
      { method: "GET" },
      await this.adminToken()
    );
    return response.data.items?.find((user) => user.email.toLowerCase() === email.toLowerCase());
  }

  private async fetchAdminGroups() {
    const response = await this.request<Sub2Envelope<Sub2ListDto<Sub2GroupDto>>>(
      "/api/v1/admin/groups",
      { method: "GET" },
      await this.adminToken()
    );
    return response.data.items ?? [];
  }

  private async fetchAdminAccounts() {
    const response = await this.request<Sub2Envelope<Sub2ListDto<Sub2AccountDto>>>(
      "/api/v1/admin/accounts",
      { method: "GET" },
      await this.adminToken()
    );
    return response.data.items ?? [];
  }

  private async defaultGroupId() {
    if (env.SUB2_DEFAULT_GROUP_ID) return env.SUB2_DEFAULT_GROUP_ID;
    if (this.discoveredDefaultGroupId !== undefined) return this.discoveredDefaultGroupId ?? undefined;

    const openAiGroup = this.resolveDefaultGroup(await this.fetchAdminGroups());

    if (!openAiGroup) {
      throw new Error("Sub2API default OpenAI group was not found. Configure SUB2_DEFAULT_GROUP_ID.");
    }

    this.discoveredDefaultGroupId = openAiGroup.id;
    return openAiGroup.id;
  }

  private resolveDefaultGroup(groups: Sub2GroupDto[]) {
    if (env.SUB2_DEFAULT_GROUP_ID) {
      return groups.find((group) => group.id === env.SUB2_DEFAULT_GROUP_ID);
    }

    return (
      groups.find((group) => group.status === "active" && group.platform === "openai") ??
      groups.find((group) => group.status === "active" && group.name.toLowerCase().includes("openai")) ??
      groups.find((group) => group.status === "active" && group.name.toLowerCase().includes("oai"))
    );
  }

  private async isGatewayReachable() {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/health`, {}, 5_000);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async fetchGatewayJson(
    path: string,
    apiKey: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Sub2GatewayJsonProbe> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${apiKey}`);
      if (init.body) headers.set("content-type", "application/json");

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
      const rawText = await response.text();
      const bodyText = (this.redactSensitiveText(rawText) ?? "").slice(0, 3000);
      let json: Record<string, any> | undefined;
      try {
        json = JSON.parse(rawText) as Record<string, any>;
      } catch {
        json = undefined;
      }

      return { ok: response.ok, statusCode: response.status, bodyText, json };
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        bodyText: "",
        error: this.redactSensitiveText(error instanceof Error ? error.message : String(error))
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private gatewayErrorObject(json?: Record<string, any>) {
    const error = json?.error;
    if (!error) return undefined;
    if (typeof error === "string") {
      return { message: this.redactSensitiveText(error), type: null };
    }
    if (typeof error === "object") {
      return error as { message?: string | null; type?: string | null };
    }
    return undefined;
  }

  private extractGatewayError(probe: Sub2GatewayJsonProbe) {
    const gatewayError = this.gatewayErrorObject(probe.json);
    if (gatewayError?.message) return this.redactSensitiveText(String(gatewayError.message));
    const fallback = probe.error ?? probe.bodyText.slice(0, 300);
    return fallback || null;
  }

  private toAccountStatus(account: Sub2AccountDto): Sub2GatewayAccountStatus {
    return {
      id: account.id,
      name: account.name,
      platform: account.platform,
      type: account.type,
      status: account.status,
      errorMessage: this.redactSensitiveText(account.error_message ?? undefined),
      credentialsStatus: this.summarizeCredentialsStatus(account.credentials_status),
      groupIds: account.group_ids ?? account.groups?.map((group) => group.id) ?? [],
      groupNames: account.groups?.map((group) => group.name) ?? [],
      schedulable: account.schedulable,
      concurrency: account.concurrency,
      currentConcurrency: account.current_concurrency,
      lastUsedAt: account.last_used_at,
      rateLimitedAt: account.rate_limited_at,
      overloadUntil: account.overload_until,
      tempUnschedulableUntil: account.temp_unschedulable_until,
      tempUnschedulableReason: account.temp_unschedulable_reason,
      updatedAt: account.updated_at
    };
  }

  private redactSensitiveText(value?: string | null) {
    if (!value) return value;
    return value
      .replace(/(access_token|refresh_token|id_token|token|key|password)\s*[:=]\s*[^,}\s]+/gi, "$1:[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/g, "Bearer [REDACTED]")
      .replace(/(zyz_[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1[REDACTED]")
      .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1[REDACTED]");
  }

  private summarizeCredentialsStatus(value: unknown) {
    if (!value) return undefined;
    if (typeof value === "string") return this.redactSensitiveText(value);
    if (typeof value === "object") {
      const presentCount = Object.values(value as Record<string, unknown>).filter(Boolean).length;
      return presentCount > 0 ? `configured(${presentCount})` : "missing";
    }
    return "configured";
  }

  private parseSseEvents(raw: string) {
    const events: Record<string, unknown>[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        events.push(this.redactObjectStrings(parsed));
      } catch {
        events.push({ message: this.redactSensitiveText(payload) });
      }
    }
    return events;
  }

  private redactObjectStrings(value: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        typeof entry === "string" ? this.redactSensitiveText(entry) : entry
      ])
    );
  }

  private async managedUserToken(buyerId: string) {
    const managedUser = this.managedUser(buyerId);
    return this.loginManagedUser(managedUser.email, managedUser.password);
  }

  private async loginManagedUser(email: string, password: string) {
    const response = await this.request<Sub2Envelope<{ access_token: string }>>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    return response.data.access_token;
  }

  private async adminToken() {
    if (env.SUB2_ADMIN_TOKEN) return env.SUB2_ADMIN_TOKEN;
    if (this.adminAccessToken) return this.adminAccessToken;
    if (!env.SUB2_ADMIN_EMAIL || !env.SUB2_ADMIN_PASSWORD) {
      throw new Error("Sub2API admin credentials are not configured");
    }
    this.adminAccessToken = await this.loginManagedUser(env.SUB2_ADMIN_EMAIL, env.SUB2_ADMIN_PASSWORD);
    return this.adminAccessToken;
  }

  private async request<T = unknown>(path: string, init: RequestInit, bearerToken?: string): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);

    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });

    if (!response.ok) {
      throw await this.errorFromResponse(response, "Sub2API request failed");
    }

    return this.readJson<T>(response);
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs = env.SUB2_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Sub2ApiError) throw error;
      const timedOut = error instanceof Error && error.name === "AbortError";
      if (timedOut) {
        throw new Sub2ApiError("timeout", `Sub2API request timed out after ${timeoutMs}ms`, undefined, true);
      }
      const message = this.redactSensitiveText(error instanceof Error ? error.message : String(error)) ?? "Network error";
      throw new Sub2ApiError("network", `Sub2API network error: ${message}`, undefined, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async errorFromResponse(response: Response, prefix: string) {
    const rawBody = await response.text();
    const body = (this.redactSensitiveText(rawBody) ?? "").slice(0, 3000);
    const kind = this.classifyHttpStatus(response.status, body);
    const retryable = kind === "rate_limited" || kind === "upstream";
    const message = `${prefix}: ${response.status} ${kind}${body ? ` ${body}` : ""}`;
    return new Sub2ApiError(kind, message, response.status, retryable, body);
  }

  private async readJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch (error) {
      const message = this.redactSensitiveText(error instanceof Error ? error.message : String(error)) ?? "Invalid JSON";
      throw new Sub2ApiError("invalid_response", `Sub2API returned invalid JSON: ${message}`, response.status, false);
    }
  }

  private classifyHttpStatus(statusCode: number, body: string): Sub2ApiErrorKind {
    const normalized = body.toLowerCase();
    if (statusCode === 401 || statusCode === 403) return "authentication";
    if (statusCode === 400 || statusCode === 404 || statusCode === 422) return "parameter";
    if (statusCode === 409) return "conflict";
    if (statusCode === 402 || normalized.includes("quota") || normalized.includes("balance") || normalized.includes("insufficient")) return "resource";
    if (statusCode === 429 || normalized.includes("rate limit") || normalized.includes("too many")) return "rate_limited";
    if (statusCode >= 500) return "upstream";
    return "unknown";
  }

  private headers(bearerToken?: string): HeadersInit {
    const headers = new Headers();
    if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);
    return headers;
  }

  private managedUser(buyerId: string) {
    const localPart = createHash("sha256").update(`user:${buyerId}`).digest("hex").slice(0, 20);
    const password = createHash("sha256")
      .update(`sub2-managed-password:${buyerId}:${env.JWT_ACCESS_SECRET}`)
      .digest("base64url")
      .slice(0, 32);
    return {
      email: `${localPart}@managed.zhisuan.local`,
      password
    };
  }

  private generateBuyerApiKey() {
    return `zyz_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  }

  private normalizeUsage(items: unknown[]): Sub2UsageRecord[] {
    return items.map((raw) => {
      const item = raw as Record<string, unknown>;
      const apiKey = item.api_key as Record<string, unknown> | undefined;
      const account = item.account as Record<string, unknown> | undefined;
      return {
        id: String(item.id),
        apiKeyId: String(item.api_key_id ?? apiKey?.id ?? ""),
        upstreamAccountId: account?.id ? String(account.id) : item.account_id ? String(item.account_id) : undefined,
        resourceType: String(item.platform ?? item.resource_type ?? "codex"),
        model: item.model ? String(item.model) : undefined,
        inputUnits: String(item.input_tokens ?? item.input_units ?? 0),
        outputUnits: String(item.output_tokens ?? item.output_units ?? 0),
        apiEquivalentCost: String(item.cost ?? item.api_equivalent_cost ?? 0),
        occurredAt: String(item.created_at ?? item.occurred_at ?? new Date().toISOString())
      };
    });
  }
}

export const sub2Client = new Sub2ApiClient();
