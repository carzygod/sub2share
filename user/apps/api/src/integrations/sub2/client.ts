import { createHash, randomUUID } from "node:crypto";
import { env } from "../../config/env.js";

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
}

interface Sub2ApiKeyDto {
  id: number;
  user_id: number;
  key: string;
  name: string;
  status: string;
}

interface Sub2UsageListDto {
  items?: unknown[];
  next_cursor?: string;
}

export class Sub2ApiClient {
  private readonly baseUrl = env.SUB2_BASE_URL.replace(/\/$/, "");
  private adminAccessToken?: string;

  async createKey(input: CreateSub2KeyInput): Promise<Sub2KeyResult> {
    const managedUser = this.managedUser(input.buyerId);
    await this.ensureManagedUser(managedUser.email, managedUser.password, input.maxConcurrency);
    const accessToken = await this.loginManagedUser(managedUser.email, managedUser.password);
    const apiKey = this.generateBuyerApiKey();

    const response = await this.request<Sub2Envelope<Sub2ApiKeyDto>>(
      "/api/v1/keys",
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          custom_key: apiKey,
          quota: input.spendLimit ? Number(input.spendLimit) : 0,
          expires_in_days: null,
          rate_limit_5h: 0,
          rate_limit_1d: 0,
          rate_limit_7d: 0
        })
      },
      accessToken
    );

    return {
      sub2UserId: String(response.data.user_id),
      sub2KeyId: String(response.data.id),
      apiKey,
      endpointUrl: env.SUB2_PUBLIC_ENDPOINT
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
    const response = await fetch(url, { headers: this.headers(await this.adminToken()) });
    if (!response.ok) {
      throw new Error(`Sub2 usage sync failed: ${response.status} ${await response.text()}`);
    }
    const envelope = (await response.json()) as Sub2Envelope<Sub2UsageListDto>;
    return {
      records: this.normalizeUsage(envelope.data.items ?? []),
      nextCursor: envelope.data.next_cursor
    };
  }

  private async ensureManagedUser(email: string, password: string, concurrency: number) {
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
            balance: 0,
            concurrency,
            rpm_limit: 0,
            allowed_groups: []
          })
        },
        await this.adminToken()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("409") && !message.toLowerCase().includes("exist")) throw error;
    }
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sub2API request failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<T>;
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
