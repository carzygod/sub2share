import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import { prisma } from "./prisma.js";

export interface AuthUser {
  type?: "access";
  id: string;
  email: string;
  roles: string[];
  status: string;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function requireAuth(request: FastifyRequest) {
  let decoded: AuthUser;
  try {
    decoded = await request.jwtVerify<AuthUser>();
  } catch {
    throw new AppError("unauthorized", "Please login first", 401);
  }
  if (decoded.type && decoded.type !== "access") {
    throw new AppError("unauthorized", "Please login first", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: {
      id: true,
      email: true,
      status: true,
      roles: { select: { role: true } }
    }
  });
  if (!user) throw new AppError("unauthorized", "Please login first", 401);
  if (user.status !== "active") {
    throw new AppError("account_disabled", "Account is disabled", 403);
  }

  request.authUser = {
    id: user.id,
    email: user.email,
    status: user.status,
    roles: user.roles.map((role) => role.role)
  };
  return request.authUser;
}

export async function requireRole(request: FastifyRequest, roles: string[]) {
  const user = await requireAuth(request);
  if (!user.roles.some((role) => roles.includes(role))) {
    throw new AppError("forbidden", "Permission denied", 403);
  }
  return user;
}
