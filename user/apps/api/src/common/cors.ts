import { openAiProxyCorsExposedHeaders, openAiProxyRouteMethods } from "../modules/openai-proxy/helpers.js";

export interface ApiCorsPolicyInput {
  nodeEnv?: string;
  appPublicUrl?: string;
  adminPublicUrl?: string;
  apiPublicUrl?: string;
  openAiProxyPublicEndpoint?: string;
  corsAllowedOrigins?: string;
}

export function buildApiCorsOptions(input: ApiCorsPolicyInput = process.env) {
  const policy = inspectApiCorsPolicy(input);
  return {
    origin: policy.summary.enforced ? policy.summary.allowedOrigins : true,
    credentials: true,
    methods: [...openAiProxyRouteMethods],
    exposedHeaders: openAiProxyCorsExposedHeaders
  };
}

export const apiCorsOptions = buildApiCorsOptions();

export function inspectApiCorsPolicy(input: ApiCorsPolicyInput = process.env) {
  const nodeEnv = input.nodeEnv ?? "development";
  const enforced = nodeEnv === "production";
  const configuredEntries = splitOrigins(input.corsAllowedOrigins);
  const derivedEntries = [
    input.appPublicUrl,
    input.adminPublicUrl,
    input.apiPublicUrl,
    input.openAiProxyPublicEndpoint
  ];
  const invalidEntries: string[] = [];
  const wildcardEntries = configuredEntries.filter((entry) => entry === "*");
  const allowedOrigins = uniqueStrings(
    [...configuredEntries, ...derivedEntries]
      .filter((entry): entry is string => Boolean(entry))
      .flatMap((entry) => {
        if (entry === "*") return [];
        const origin = normalizedOrigin(entry);
        if (!origin) {
          invalidEntries.push(entry);
          return [];
        }
        return [origin];
      })
  );
  const issues: Array<{ id: string; type: string; severity: "warning" | "error"; refId: string; actionHint: string; message: string }> = [];

  if (enforced && allowedOrigins.length === 0) {
    issues.push({
      id: "cors_allowed_origins_missing",
      type: "cors_allowed_origins_missing",
      severity: "error",
      refId: "CORS_ALLOWED_ORIGINS",
      actionHint: "Configure CORS_ALLOWED_ORIGINS or the public APP/API/Admin URLs before serving browser clients in production.",
      message: "Production CORS is enforced but no allowed origins could be resolved."
    });
  }
  if (enforced && wildcardEntries.length > 0) {
    issues.push({
      id: "cors_wildcard_origin_rejected",
      type: "cors_wildcard_origin_rejected",
      severity: "error",
      refId: "CORS_ALLOWED_ORIGINS",
      actionHint: "Replace '*' with explicit application, admin, and API origins.",
      message: "Production CORS must not allow wildcard origins."
    });
  }
  for (const entry of uniqueStrings(invalidEntries)) {
    issues.push({
      id: `cors_invalid_origin:${entry}`,
      type: "cors_invalid_origin",
      severity: "warning",
      refId: "CORS_ALLOWED_ORIGINS",
      actionHint: "Use full http(s) origins such as https://app.example.com.",
      message: `CORS origin ${entry} is not a valid URL and was ignored.`
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    summary: {
      nodeEnv,
      enforced,
      allowedOrigins,
      allowedOriginCount: allowedOrigins.length,
      configuredOriginCount: configuredEntries.length,
      invalidOriginCount: invalidEntries.length,
      allowedMethods: openAiProxyRouteMethods.join(","),
      exposesHeaders: openAiProxyCorsExposedHeaders.join(",")
    },
    issues
  };
}

function splitOrigins(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizedOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
