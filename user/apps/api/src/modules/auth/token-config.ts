export interface AuthTokenConfigInput {
  nodeEnv: string;
  accessSecret: string;
  refreshSecret?: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
}

export function inspectAuthTokenConfig(input: AuthTokenConfigInput) {
  const effectiveRefreshSecret = input.refreshSecret ?? input.accessSecret;
  const issues: Array<{ type: string; severity: "warning" | "error"; message: string }> = [];

  if (!input.refreshSecret) {
    issues.push({
      type: "jwt_refresh_secret_missing",
      severity: input.nodeEnv === "production" ? "error" : "warning",
      message: "JWT_REFRESH_SECRET is not configured; refresh tokens fall back to JWT_ACCESS_SECRET"
    });
  } else if (effectiveRefreshSecret === input.accessSecret) {
    issues.push({
      type: "jwt_refresh_secret_reuses_access_secret",
      severity: input.nodeEnv === "production" ? "error" : "warning",
      message: "JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET"
    });
  }

  if (input.accessExpiresIn === input.refreshExpiresIn) {
    issues.push({
      type: "jwt_refresh_lifetime_not_longer",
      severity: "warning",
      message: "JWT_REFRESH_EXPIRES_IN should be longer than JWT_ACCESS_EXPIRES_IN"
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    summary: {
      accessExpiresIn: input.accessExpiresIn,
      refreshExpiresIn: input.refreshExpiresIn,
      refreshSecretConfigured: Boolean(input.refreshSecret),
      refreshSecretDistinct: effectiveRefreshSecret !== input.accessSecret
    },
    issues
  };
}
