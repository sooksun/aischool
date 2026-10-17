// Prisma 7 configuration (ADR-0012 §5). The connection URL left schema.prisma in
// Prisma 7; the CLI reads it from here. The app never uses this file — it
// connects through @prisma/adapter-pg in packages/database/src/client.ts.
//
// Migrations run as the schema owner (seip_migrator) when MIGRATE_DATABASE_URL
// is set, which is what `npm run db:migrate` and CI do (ADR-0012 §4).
// process.env, not prisma/config's env(): env() throws when the variable is
// unset, and `prisma generate` / `validate` must work with no database at all.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
