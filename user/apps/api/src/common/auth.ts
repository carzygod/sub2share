import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function requireAuth(request: FastifyRequest) {
  try {
    const decoded = await request.jwtVerify<AuthUser>();
    request.authUser = decoded;
    return decoded;
  } catch {
    throw new AppError("unauthorized", "Please login first", 401);
  }
}

export async function requireRole(request: FastifyRequest, roles: string[]) {
  const user = await requireAuth(request);
  if (!user.roles.some((role) => roles.includes(role))) {
    throw new AppError("forbidden", "Permission denied", 403);
  }
  return user;
}

