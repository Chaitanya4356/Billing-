import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";

export interface SeedEnv {
  shopName: string;
  ownerUsername: string;
  ownerPassword: string;
}

/**
 * Creates the first shop, its default settings and an owner account.
 * Idempotent: does nothing (and returns) if any shop already exists.
 */
export async function seedShop(env: SeedEnv): Promise<void> {
  // Imported lazily so that the CLI can load .env before the db client reads DATABASE_URL.
  const { db } = await import("@/db/client");
  const { shopSettings, shops, users } = await import("@/db/schema");
  const { hashPassword } = await import("@/modules/auth/password");

  const existing = await db.select({ id: shops.id }).from(shops).limit(1);
  if (existing.length > 0) return;

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
}

async function main(): Promise<void> {
  config({ path: ".env", quiet: true });
  const shopName = process.env.SEED_SHOP_NAME?.trim();
  const ownerUsername = process.env.SEED_OWNER_USERNAME?.trim();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!shopName || !ownerUsername || !ownerPassword) {
    throw new Error("SEED_SHOP_NAME, SEED_OWNER_USERNAME and SEED_OWNER_PASSWORD must be set");
  }
  if (ownerPassword.length < 8) {
    throw new Error("SEED_OWNER_PASSWORD must be at least 8 characters");
  }

  await seedShop({ shopName, ownerUsername, ownerPassword });
  const { db } = await import("@/db/client");
  const { shops } = await import("@/db/schema");
  const rows = await db.select({ name: shops.name }).from(shops).limit(1);
  console.log(`Seed complete (shop: ${rows[0]?.name ?? "none"}).`);
}

// Only run when executed directly (npm run seed), never when imported by tests.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
