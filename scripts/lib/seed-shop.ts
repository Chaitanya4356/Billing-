// Library half of `npm run seed`: imported by scripts/seed.ts (the CLI entry) and by tests.
// No side effects at import time.

export interface SeedEnv {
  shopName: string;
  ownerUsername: string;
  ownerPassword: string;
}

/**
 * Creates the first shop, its default settings and an owner account.
 * Idempotent: does nothing if any shop already exists.
 * Returns true when it created the shop, false when one already existed.
 */
export async function seedShop(env: SeedEnv): Promise<boolean> {
  // Imported lazily so that the CLI can load .env before the db client reads DATABASE_URL.
  const { db } = await import("@/db/client");
  const { shopSettings, shops, users } = await import("@/db/schema");
  const { hashPassword } = await import("@/modules/auth/password");

  const existing = await db.select({ id: shops.id }).from(shops).limit(1);
  if (existing.length > 0) return false;

  const passwordHash = await hashPassword(env.ownerPassword);
  await db.transaction(async (tx) => {
    const [shop] = await tx.insert(shops).values({ name: env.shopName }).returning({ id: shops.id });
    await tx.insert(shopSettings).values({ shopId: shop.id });
    await tx.insert(users).values({
      shopId: shop.id,
      name: env.ownerUsername,
      username: env.ownerUsername,
      passwordHash,
      role: "OWNER",
    });
  });
  return true;
}
