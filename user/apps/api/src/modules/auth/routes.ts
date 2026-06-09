import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";

type OAuthProvider = "google" | "x";

interface OAuthState {
  provider: OAuthProvider;
  codeVerifier: string;
  expiresAt: number;
}

interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(64).optional()
});

const oauthStartParamsSchema = z.object({
  provider: z.enum(["google", "x"])
});

const oauthCallbackParamsSchema = z.object({
  provider: z.enum(["google", "x"])
});

const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional()
});

const oauthStates = new Map<string, OAuthState>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/capabilities", async (_request, reply) => {
    return ok(reply, {
      passwordAuth: isPasswordAuthEnabled(),
      oauth: {
        google: isGoogleConfigured(),
        x: isXConfigured()
      }
    });
  });

  app.post("/api/auth/register", async (request, reply) => {
    if (!isPasswordAuthEnabled()) {
      throw new AppError("password_signup_disabled", "Password signup is disabled. Please sign in with Google or X.", 410);
    }

    const input = registerSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existing) throw new AppError("email_exists", "Email already registered", 409);

    const user = await prisma.$transaction(async (tx) => tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 12),
        displayName: input.displayName,
        roles: { create: { role: "buyer" } },
        wallet: { create: { currency: "USD" } }
      },
      include: { roles: true }
    }));

    const token = signAuthToken(app, user);
    return ok(reply, { token, user: publicUser(user) });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() }, include: { roles: true } });
    if (!user) throw new AppError("invalid_credentials", "Invalid email or password", 401);

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) throw new AppError("invalid_credentials", "Invalid email or password", 401);
    if (user.status !== "active") throw new AppError("account_disabled", "Account is disabled", 403);

    const roles = user.roles.map((role) => role.role);
    const canUsePasswordLogin = isPasswordAuthEnabled() || roles.includes("admin") || roles.includes("operator");
    if (!canUsePasswordLogin) {
      throw new AppError("oauth_required", "User password login is disabled. Please sign in with Google or X.", 403);
    }

    const token = signAuthToken(app, user);
    return ok(reply, { token, user: publicUser(user) });
  });

  app.get("/api/auth/oauth/:provider/start", async (request, reply) => {
    const { provider } = oauthStartParamsSchema.parse(request.params);
    const state = createState(provider);
    const authorizationUrl = buildAuthorizationUrl(provider, state);
    return reply.redirect(authorizationUrl);
  });

  app.get("/api/auth/oauth/:provider/callback", async (request, reply) => {
    const { provider } = oauthCallbackParamsSchema.parse(request.params);
    const query = oauthCallbackQuerySchema.parse(request.query);

    if (query.error) {
      return redirectOAuthResult(reply, { error: query.error });
    }

    if (!query.code || !query.state) {
      return redirectOAuthResult(reply, { error: "missing_oauth_callback_params" });
    }

    const state = consumeState(provider, query.state);
    const profile = provider === "google"
      ? await fetchGoogleProfile(query.code, state.codeVerifier)
      : await fetchXProfile(query.code, state.codeVerifier);
    const user = await findOrCreateOAuthUser(profile);

    if (user.status !== "active") {
      return redirectOAuthResult(reply, { error: "account_disabled" });
    }

    const token = signAuthToken(app, user);
    return redirectOAuthResult(reply, { token });
  });

  app.get("/api/me", async (request, reply) => {
    const authUser = await requireAuth(request);
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      include: { roles: true, wallet: true, supplier: true }
    });
    if (!user) throw new AppError("user_not_found", "User not found", 404);
    return ok(reply, publicUser(user));
  });
}

function createState(provider: OAuthProvider) {
  pruneExpiredStates();
  const state = randomToken(32);
  oauthStates.set(state, {
    provider,
    codeVerifier: randomToken(48),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  });
  return state;
}

function consumeState(provider: OAuthProvider, state: string) {
  pruneExpiredStates();
  const value = oauthStates.get(state);
  oauthStates.delete(state);
  if (!value || value.provider !== provider || value.expiresAt < Date.now()) {
    throw new AppError("invalid_oauth_state", "OAuth state is invalid or expired", 401);
  }
  return value;
}

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, value] of oauthStates.entries()) {
    if (value.expiresAt < now) oauthStates.delete(state);
  }
}

function buildAuthorizationUrl(provider: OAuthProvider, state: string) {
  const oauthState = oauthStates.get(state);
  if (!oauthState) throw new AppError("invalid_oauth_state", "OAuth state could not be created", 500);
  const challenge = createCodeChallenge(oauthState.codeVerifier);

  if (provider === "google") {
    ensureGoogleConfigured();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID!);
    url.searchParams.set("redirect_uri", env.GOOGLE_OAUTH_REDIRECT_URI!);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  ensureXConfigured();
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.X_OAUTH_CLIENT_ID!);
  url.searchParams.set("redirect_uri", env.X_OAUTH_REDIRECT_URI!);
  url.searchParams.set("scope", "users.read users.email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function fetchGoogleProfile(code: string, codeVerifier: string): Promise<OAuthProfile> {
  ensureGoogleConfigured();
  const token = await postForm<{ access_token?: string; error?: string }>("https://oauth2.googleapis.com/token", {
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI!,
    grant_type: "authorization_code",
    code_verifier: codeVerifier
  });
  if (!token.access_token) throw new AppError("oauth_token_exchange_failed", token.error ?? "Google token exchange failed", 401);

  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  const profile = await response.json() as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!response.ok || !profile.sub) throw new AppError("oauth_profile_failed", "Google profile fetch failed", 401, profile);

  return {
    provider: "google",
    providerUserId: profile.sub,
    email: profile.email_verified ? profile.email?.toLowerCase() : undefined,
    displayName: profile.name,
    avatarUrl: profile.picture
  };
}

async function fetchXProfile(code: string, codeVerifier: string): Promise<OAuthProfile> {
  ensureXConfigured();
  const basic = Buffer.from(`${env.X_OAUTH_CLIENT_ID!}:${env.X_OAUTH_CLIENT_SECRET!}`).toString("base64");
  const token = await postForm<{ access_token?: string; error?: string }>(
    "https://api.x.com/2/oauth2/token",
    {
      code,
      grant_type: "authorization_code",
      client_id: env.X_OAUTH_CLIENT_ID!,
      redirect_uri: env.X_OAUTH_REDIRECT_URI!,
      code_verifier: codeVerifier
    },
    { authorization: `Basic ${basic}` }
  );
  if (!token.access_token) throw new AppError("oauth_token_exchange_failed", token.error ?? "X token exchange failed", 401);

  const response = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url,verified,verified_type", {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  const profile = await response.json() as {
    data?: {
      id?: string;
      name?: string;
      username?: string;
      email?: string;
      profile_image_url?: string;
    };
  };
  if (!response.ok || !profile.data?.id) throw new AppError("oauth_profile_failed", "X profile fetch failed", 401, profile);

  return {
    provider: "x",
    providerUserId: profile.data.id,
    email: profile.data.email?.toLowerCase(),
    displayName: profile.data.name || profile.data.username,
    avatarUrl: profile.data.profile_image_url
  };
}

async function findOrCreateOAuthUser(profile: OAuthProfile) {
  const existingIdentity = await prisma.userIdentity.findUnique({
    where: {
      provider_providerUserId: {
        provider: profile.provider,
        providerUserId: profile.providerUserId
      }
    },
    include: { user: { include: { roles: true } } }
  });

  if (existingIdentity) {
    await prisma.userIdentity.update({
      where: { id: existingIdentity.id },
      data: {
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl
      }
    });
    return existingIdentity.user;
  }

  return prisma.$transaction(async (tx) => {
    const email = profile.email ?? `${profile.provider}-${profile.providerUserId}@oauth.local`;
    const existingUser = await tx.user.findUnique({ where: { email }, include: { roles: true } });
    const user = existingUser ?? await tx.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(`oauth-only:${randomToken(32)}`, 12),
        displayName: profile.displayName,
        roles: { create: { role: "buyer" } },
        wallet: { create: { currency: "USD" } }
      },
      include: { roles: true }
    });

    await tx.userIdentity.create({
      data: {
        userId: user.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl
      }
    });

    return user;
  });
}

async function postForm<T>(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers
    },
    body: new URLSearchParams(body)
  });
  const data = await response.json() as T;
  if (!response.ok) {
    throw new AppError("oauth_http_error", "OAuth provider request failed", 401, data);
  }
  return data;
}

function redirectOAuthResult(reply: FastifyReply, result: { token?: string; error?: string }) {
  const url = new URL(env.APP_PUBLIC_URL);
  const params = new URLSearchParams();
  if (result.token) params.set("auth_token", result.token);
  if (result.error) params.set("auth_error", result.error);
  url.hash = params.toString();
  return reply.redirect(url.toString());
}

function signAuthToken(app: FastifyInstance, user: { id: string; email: string; roles: { role: string }[] }) {
  return app.jwt.sign({
    id: user.id,
    email: user.email,
    roles: user.roles.map((role) => role.role)
  });
}

function publicUser(user: { id: string; email: string; displayName: string | null; status: string; roles: { role: string }[] }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles.map((role) => role.role)
  };
}

function ensureGoogleConfigured() {
  if (!isGoogleConfigured()) {
    throw new AppError("google_oauth_not_configured", "Google OAuth is not configured", 503);
  }
}

function ensureXConfigured() {
  if (!isXConfigured()) {
    throw new AppError("x_oauth_not_configured", "X OAuth is not configured", 503);
  }
}

function isGoogleConfigured() {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI);
}

function isXConfigured() {
  return Boolean(env.X_OAUTH_CLIENT_ID && env.X_OAUTH_CLIENT_SECRET && env.X_OAUTH_REDIRECT_URI);
}

function isPasswordAuthEnabled() {
  return !isGoogleConfigured() && !isXConfigured();
}

function createCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function randomToken(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}
