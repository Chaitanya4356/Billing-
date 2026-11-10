// CLI entry for `npm run seed`. The seeding itself lives in ./lib/seed-shop.ts.
import { config } from "dotenv";
import { seedShop } from "./lib/seed-shop";

async function main(): Promise<void> {
  config({ path: ".env", quiet: true });
  // Validate everything before any database access.
  const shopName = process.env.SEED_SHOP_NAME?.trim();
  const ownerUsername = process.env.SEED_OWNER_USERNAME?.trim();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!shopName || !ownerUsername || !ownerPassword) {
    throw new Error("SEED_SHOP_NAME, SEED_OWNER_USERNAME and SEED_OWNER_PASSWORD must be set");
  }
  if (ownerPassword.length < 8) {
    throw new Error("SEED_OWNER_PASSWORD must be at least 8 characters");
  }

  const created = await seedShop({ shopName, ownerUsername, ownerPassword });
  const { db } = await import("@/db/client");
  const { shops } = await import("@/db/schema");
  const rows = await db.select({ name: shops.name }).from(shops).limit(1);
  const name = rows[0]?.name ?? "none";
  console.log(
    created
      ? `Seed complete (shop: ${name}).`
      : `Seed skipped: a shop already exists (shop: ${name}). Nothing was changed.`,
  );
}

// Entry point: runs unconditionally. Any rejection prints the failure and exits 1 (fail closed).
main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`seed FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
