import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@zhisuan.local" },
    update: { displayName: "智算驿站管理员" },
    create: {
      email: "admin@zhisuan.local",
      passwordHash,
      displayName: "智算驿站管理员",
      roles: {
        create: [{ role: "admin" }, { role: "operator" }, { role: "buyer" }]
      },
      wallet: {
        create: { currency: "USD", availableBalance: 1000, totalRecharged: 1000 }
      }
    }
  });

  const codex = await prisma.product.upsert({
    where: { id: "00000000-0000-0000-0000-000000000101" },
    update: {
      name: "Codex 标准租赁",
      description: "适合日常 coding agent 任务的标准套餐",
      status: "active"
    },
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      name: "Codex 标准租赁",
      resourceType: "codex",
      billingMode: "monthly",
      description: "适合日常 coding agent 任务的标准套餐",
      status: "active"
    }
  });

  await prisma.productPrice.upsert({
    where: {
      productId_tierCode: {
        productId: codex.id,
        tierCode: "standard_monthly"
      }
    },
    update: {
      displayName: "标准月租",
      fixedPrice: 20,
      durationDays: 30,
      discountRate: 0.2,
      tierMultiplier: 1,
      maxConcurrency: 1,
      rpmLimit: 60,
      tpmLimit: 120000,
      requestLimit: 1000,
      status: "active"
    },
    create: {
      productId: codex.id,
      tierCode: "standard_monthly",
      displayName: "标准月租",
      fixedPrice: 20,
      durationDays: 30,
      discountRate: 0.2,
      tierMultiplier: 1,
      maxConcurrency: 1,
      rpmLimit: 60,
      tpmLimit: 120000,
      requestLimit: 1000,
      status: "active"
    }
  });

  console.log(`Seeded admin user: ${admin.email}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
