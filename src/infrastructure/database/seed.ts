import { AppDataSource } from './data-source';

/**
 * Placeholder — step 12 replaces this with the real seed (products,
 * warehouses, inventory, the four scenarios). Exists now so the
 * docker-compose chain this step wires (postgres -> migrate -> seed ->
 * api/worker) is genuinely runnable end to end, not just declared: without
 * this file, the `seed` service would have nothing to run and api/worker
 * would never start, leaving `docker compose up` broken until step 12.
 *
 * Still a real check, not a no-op: connecting confirms the `seed` service
 * can reach the database with the same DataSource the migration used.
 */
async function seed(): Promise<void> {
  await AppDataSource.initialize();
  console.log('Seed placeholder — real data lands in step 12.');
  await AppDataSource.destroy();
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
