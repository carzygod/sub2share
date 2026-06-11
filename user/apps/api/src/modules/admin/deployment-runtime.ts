import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface DeploymentRuntimeInput {
  cwd: string;
  nodeEnv: string;
  markerText?: string | null;
  markerReadError?: string | null;
}

export interface DeploymentRuntimeIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  refId: string;
  actionHint: string;
  message: string;
}

export function inspectCurrentDeploymentRuntime(nodeEnv = process.env.NODE_ENV ?? "development") {
  const cwd = process.cwd();
  const releaseRoot = inferReleaseRoot(cwd);
  const markerPath = joinPath(releaseRoot, ".release-marker");
  let markerText: string | null = null;
  let markerReadError: string | null = null;

  try {
    markerText = existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null;
  } catch (error) {
    markerReadError = error instanceof Error ? error.message : String(error);
  }

  return inspectDeploymentRuntime({
    cwd,
    nodeEnv,
    markerText,
    markerReadError
  });
}

export function inspectDeploymentRuntime(input: DeploymentRuntimeInput) {
  const releaseRoot = inferReleaseRoot(input.cwd);
  const markerPath = joinPath(releaseRoot, ".release-marker");
  const marker = parseReleaseMarker(input.markerText);
  const normalizedCwd = normalizePath(input.cwd);
  const normalizedReleaseRoot = normalizePath(releaseRoot);
  const runningFromReplacedRelease = /\/user-replaced-[^/]+/.test(normalizedCwd) || /\/user-replaced-[^/]+/.test(normalizedReleaseRoot);
  const runningFromStagingRelease = /\/user\.new-[^/]+/.test(normalizedCwd) || /\/user\.new-[^/]+/.test(normalizedReleaseRoot);
  const issues: DeploymentRuntimeIssue[] = [];

  if (runningFromReplacedRelease) {
    issues.push({
      id: "deployment_runtime:running_from_replaced_release",
      type: "running_from_replaced_release",
      severity: "error",
      refId: "process.cwd",
      actionHint: "Restart the API/Web/Admin processes from /opt/zhisuan-yizhan/user after switching the release directory.",
      message: `Process is running from a replaced release path: ${input.cwd}`
    });
  }

  if (runningFromStagingRelease) {
    issues.push({
      id: "deployment_runtime:running_from_staging_release",
      type: "running_from_staging_release",
      severity: "error",
      refId: "process.cwd",
      actionHint: "Do not serve traffic from user.new-* staging directories; finish the release switch and restart services from the current release path.",
      message: `Process is running from a staging release path: ${input.cwd}`
    });
  }

  if (input.markerReadError) {
    issues.push({
      id: "deployment_runtime:release_marker_unreadable",
      type: "release_marker_unreadable",
      severity: input.nodeEnv === "production" ? "warning" : "warning",
      refId: markerPath,
      actionHint: "Ensure the deployment writes a readable .release-marker in the user release root.",
      message: `Release marker could not be read: ${input.markerReadError}`
    });
  } else if (!input.markerText && input.nodeEnv === "production") {
    issues.push({
      id: "deployment_runtime:release_marker_missing",
      type: "release_marker_missing",
      severity: "warning",
      refId: markerPath,
      actionHint: "Write .release-marker during deployment so administrators can match running services to a Git commit.",
      message: "Production release marker is missing."
    });
  } else if (input.markerText && !marker.commit) {
    issues.push({
      id: "deployment_runtime:release_commit_missing",
      type: "release_commit_missing",
      severity: "warning",
      refId: markerPath,
      actionHint: "Include commit=<short sha> in .release-marker.",
      message: "Release marker exists but does not include a commit."
    });
  }

  const status = issues.some((issue) => issue.severity === "error")
    ? "error" as const
    : issues.length > 0 ? "warning" as const : "ok" as const;

  return {
    ok: status === "ok",
    status,
    summary: {
      nodeEnv: input.nodeEnv,
      cwd: input.cwd,
      releaseRoot,
      releaseRootName: pathApi(releaseRoot).basename(releaseRoot),
      markerPath,
      markerPresent: Boolean(input.markerText),
      commit: marker.commit,
      deployedAt: marker.deployed_at,
      runningFromReplacedRelease,
      runningFromStagingRelease
    },
    issues
  };
}

function inferReleaseRoot(cwd: string) {
  const api = pathApi(cwd);
  const normalized = api.resolve(cwd);
  if (api.basename(normalized) === "api" && api.basename(api.dirname(normalized)) === "apps") {
    return api.resolve(normalized, "../..");
  }
  if (api.basename(normalized) === "web" && api.basename(api.dirname(normalized)) === "apps") {
    return api.resolve(normalized, "../..");
  }
  if (api.basename(normalized) === "admin" && api.basename(api.dirname(normalized)) === "apps") {
    return api.resolve(normalized, "../..");
  }
  return normalized;
}

function parseReleaseMarker(markerText?: string | null) {
  const values = new Map<string, string>();
  for (const line of (markerText ?? "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }

  return {
    commit: values.get("commit") ?? null,
    deployed_at: values.get("deployed_at") ?? null
  };
}

function normalizePath(value: string) {
  return pathApi(value).resolve(value).replace(/\\/g, "/");
}

function joinPath(root: string, child: string) {
  return pathApi(root).join(root, child);
}

function pathApi(value: string) {
  return value.startsWith("/") ? path.posix : path.win32;
}
