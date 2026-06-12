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
  assetProbes?: FrontendAssetProbe[] | null;
  assetScanError?: string | null;
}

export interface FrontendAssetProbe {
  endpoint: FrontendEndpointName;
  endpointUrl: string;
  assetType: "script" | "stylesheet";
  assetUrl: string;
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
  assetType?: "script" | "stylesheet" | null;
  assetUrl?: string | null;
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
    totalAssets: number;
    okAssets: number;
    failedAssets: number;
    endpointsWithoutAssets: number;
  };
  probes: FrontendEndpointProbe[];
  issues: FrontendRuntimeHealthIssue[];
}

export function inspectFrontendRuntime(probes: FrontendEndpointProbe[]): FrontendRuntimeHealth {
  const issues = probes.flatMap((probe) => frontendEndpointIssues(probe));
  const assetProbes = probes.flatMap((probe) => probe.assetProbes ?? []);
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
      nonHtmlEndpoints: issues.filter((issue) => issue.type === "frontend_endpoint_non_html").length,
      totalAssets: assetProbes.length,
      okAssets: assetProbes.filter((probe) => probe.ok && isExpectedAssetContentType(probe.assetType, probe.contentType)).length,
      failedAssets: issues.filter((issue) => issue.type.startsWith("frontend_asset_") && issue.type !== "frontend_assets_missing").length,
      endpointsWithoutAssets: issues.filter((issue) => issue.type === "frontend_assets_missing").length
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

  const assetIssues = frontendAssetIssues(probe);
  return assetIssues;
}

function frontendAssetIssues(probe: FrontendEndpointProbe): FrontendRuntimeHealthIssue[] {
  if (probe.assetScanError) {
    return [{
      id: `frontend:${probe.endpoint}:asset_scan_failed`,
      type: "frontend_assets_scan_failed",
      severity: "error",
      endpoint: probe.endpoint,
      endpointUrl: probe.url ?? null,
      error: probe.assetScanError,
      message: `${frontendEndpointLabel(probe.endpoint)} frontend assets could not be inspected: ${probe.assetScanError}.`,
      actionHint: "Check the generated index.html and static asset serving configuration."
    }];
  }

  if (!probe.assetProbes) return [];

  if (probe.assetProbes.length === 0) {
    return [{
      id: `frontend:${probe.endpoint}:assets_missing`,
      type: "frontend_assets_missing",
      severity: "error",
      endpoint: probe.endpoint,
      endpointUrl: probe.url ?? null,
      message: `${frontendEndpointLabel(probe.endpoint)} HTML did not reference any built JavaScript or stylesheet assets.`,
      actionHint: "Verify the frontend build output and ensure index.html was generated by the current Vite build."
    }];
  }

  return probe.assetProbes.flatMap((asset) => frontendAssetProbeIssues(asset));
}

function frontendAssetProbeIssues(asset: FrontendAssetProbe): FrontendRuntimeHealthIssue[] {
  if (asset.error) {
    return [{
      id: `frontend:${asset.endpoint}:asset_unreachable:${asset.assetType}:${encodeURIComponent(asset.assetUrl)}`,
      type: "frontend_asset_unreachable",
      severity: "error",
      endpoint: asset.endpoint,
      endpointUrl: asset.endpointUrl,
      assetType: asset.assetType,
      assetUrl: asset.assetUrl,
      durationMs: asset.durationMs ?? null,
      error: asset.error,
      message: `${frontendEndpointLabel(asset.endpoint)} ${asset.assetType} asset is unreachable: ${asset.error}.`,
      actionHint: "Check the frontend static service, built assets directory, and release switch."
    }];
  }

  if (!asset.ok) {
    return [{
      id: `frontend:${asset.endpoint}:asset_http_${asset.statusCode ?? "unknown"}:${asset.assetType}:${encodeURIComponent(asset.assetUrl)}`,
      type: "frontend_asset_bad_status",
      severity: "error",
      endpoint: asset.endpoint,
      endpointUrl: asset.endpointUrl,
      assetType: asset.assetType,
      assetUrl: asset.assetUrl,
      statusCode: asset.statusCode ?? null,
      contentType: asset.contentType ?? null,
      durationMs: asset.durationMs ?? null,
      message: `${frontendEndpointLabel(asset.endpoint)} ${asset.assetType} asset returned HTTP ${asset.statusCode ?? "unknown"}.`,
      actionHint: "Verify that the current release serves every asset referenced by index.html."
    }];
  }

  if (!isExpectedAssetContentType(asset.assetType, asset.contentType)) {
    return [{
      id: `frontend:${asset.endpoint}:asset_bad_content_type:${asset.assetType}:${encodeURIComponent(asset.assetUrl)}`,
      type: "frontend_asset_bad_content_type",
      severity: "error",
      endpoint: asset.endpoint,
      endpointUrl: asset.endpointUrl,
      assetType: asset.assetType,
      assetUrl: asset.assetUrl,
      statusCode: asset.statusCode ?? null,
      contentType: asset.contentType ?? null,
      durationMs: asset.durationMs ?? null,
      message: `${frontendEndpointLabel(asset.endpoint)} ${asset.assetType} asset returned unexpected content type ${asset.contentType ?? "unknown"}.`,
      actionHint: "Check reverse proxy routing and static asset MIME type handling."
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

export function extractFrontendAssetReferences(html: string, baseUrl: string): Array<{ assetType: "script" | "stylesheet"; assetUrl: string }> {
  const assets = new Map<string, { assetType: "script" | "stylesheet"; assetUrl: string }>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi)) {
    const assetUrl = resolveAssetUrl(match[2], baseUrl);
    if (assetUrl) assets.set(`script:${assetUrl}`, { assetType: "script", assetUrl });
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tagAttribute(tag, "rel");
    if (!rel?.toLowerCase().split(/\s+/).includes("stylesheet")) continue;
    const href = tagAttribute(tag, "href");
    const assetUrl = href ? resolveAssetUrl(href, baseUrl) : null;
    if (assetUrl) assets.set(`stylesheet:${assetUrl}`, { assetType: "stylesheet", assetUrl });
  }

  return [...assets.values()];
}

function tagAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function resolveAssetUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function isExpectedAssetContentType(assetType: "script" | "stylesheet", contentType?: string | null) {
  if (typeof contentType !== "string") return false;
  const normalized = contentType.toLowerCase();
  if (assetType === "stylesheet") return normalized.includes("text/css");
  return normalized.includes("javascript")
    || normalized.includes("ecmascript")
    || normalized.includes("text/plain");
}
