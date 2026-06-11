export type FrontendEndpointName = "web" | "admin";
export type FrontendRuntimeHealthStatus = "ok" | "warning" | "error";

export interface FrontendEndpointProbe {
  endpoint: FrontendEndpointName;
  url?: string | null;
  ok: boolean;
  statusCode?: number | null;
  contentType?: string | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface FrontendRuntimeHealthIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  endpoint: FrontendEndpointName;
  endpointUrl?: string | null;
  statusCode?: number | null;
  contentType?: string | null;
  durationMs?: number | null;
  error?: string | null;
  message: string;
  actionHint: string;
}

export interface FrontendRuntimeHealth {
  ok: boolean;
  status: FrontendRuntimeHealthStatus;
  summary: {
    totalEndpoints: number;
    okEndpoints: number;
    missingEndpoints: number;
    failedEndpoints: number;
    nonHtmlEndpoints: number;
  };
  probes: FrontendEndpointProbe[];
  issues: FrontendRuntimeHealthIssue[];
}

export function inspectFrontendRuntime(probes: FrontendEndpointProbe[]): FrontendRuntimeHealth {
  const issues = probes.flatMap((probe) => frontendEndpointIssues(probe));
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return {
    ok: errorCount === 0 && warningCount === 0,
    status: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "ok",
    summary: {
      totalEndpoints: probes.length,
      okEndpoints: probes.filter((probe) => probe.ok && isHtmlContentType(probe.contentType)).length,
      missingEndpoints: issues.filter((issue) => issue.type === "frontend_endpoint_missing").length,
      failedEndpoints: issues.filter((issue) => issue.type === "frontend_endpoint_unreachable" || issue.type === "frontend_endpoint_bad_status").length,
      nonHtmlEndpoints: issues.filter((issue) => issue.type === "frontend_endpoint_non_html").length
    },
    probes,
    issues
  };
}

function frontendEndpointIssues(probe: FrontendEndpointProbe): FrontendRuntimeHealthIssue[] {
  if (!probe.url) {
    return [{
      id: `frontend:${probe.endpoint}:missing_url`,
      type: "frontend_endpoint_missing",
      severity: "warning",
      endpoint: probe.endpoint,
      endpointUrl: null,
      message: `${frontendEndpointLabel(probe.endpoint)} public URL is not configured.`,
      actionHint: `Configure ${probe.endpoint === "web" ? "APP_PUBLIC_URL" : "ADMIN_PUBLIC_URL"} and redeploy.`
    }];
  }

  if (probe.error) {
    return [{
      id: `frontend:${probe.endpoint}:unreachable`,
      type: "frontend_endpoint_unreachable",
      severity: "error",
      endpoint: probe.endpoint,
      endpointUrl: probe.url,
      durationMs: probe.durationMs ?? null,
      error: probe.error,
      message: `${frontendEndpointLabel(probe.endpoint)} endpoint is unreachable: ${probe.error}.`,
      actionHint: "Check the frontend systemd service, listener port, firewall, and public URL."
    }];
  }

  if (!probe.ok) {
    return [{
      id: `frontend:${probe.endpoint}:http_${probe.statusCode ?? "unknown"}`,
      type: "frontend_endpoint_bad_status",
      severity: "error",
      endpoint: probe.endpoint,
      endpointUrl: probe.url,
      statusCode: probe.statusCode ?? null,
      contentType: probe.contentType ?? null,
      durationMs: probe.durationMs ?? null,
      message: `${frontendEndpointLabel(probe.endpoint)} endpoint returned HTTP ${probe.statusCode ?? "unknown"}.`,
      actionHint: "Open the frontend service logs and verify that the current release is serving the built dist directory."
    }];
  }

  if (!isHtmlContentType(probe.contentType)) {
    return [{
      id: `frontend:${probe.endpoint}:non_html`,
      type: "frontend_endpoint_non_html",
      severity: "error",
      endpoint: probe.endpoint,
      endpointUrl: probe.url,
      statusCode: probe.statusCode ?? null,
      contentType: probe.contentType ?? null,
      durationMs: probe.durationMs ?? null,
      message: `${frontendEndpointLabel(probe.endpoint)} endpoint did not return HTML content.`,
      actionHint: "Check reverse proxy routing and ensure the frontend entry serves index.html."
    }];
  }

  return [];
}

function frontendEndpointLabel(endpoint: FrontendEndpointName) {
  return endpoint === "web" ? "Web" : "Admin";
}

function isHtmlContentType(contentType?: string | null) {
  return typeof contentType === "string" && contentType.toLowerCase().includes("text/html");
}
