import type { Prisma } from "@prisma/client";
import { internalHealthCheckSupplierResourceSub2AccountId } from "../../common/internal-records.js";

export type SupplierResourceIdentity = {
  sub2AccountId: string | null;
};

export function isInternalHealthCheckSupplierResource(resource: SupplierResourceIdentity) {
  return resource.sub2AccountId === internalHealthCheckSupplierResourceSub2AccountId;
}

export function internalHealthCheckSupplierResourceWhere(): Prisma.SupplierResourceWhereInput {
  return { sub2AccountId: internalHealthCheckSupplierResourceSub2AccountId };
}

export function nonSmokeSupplierResourceWhere(): Prisma.SupplierResourceWhereInput {
  return { NOT: internalHealthCheckSupplierResourceWhere() };
}

