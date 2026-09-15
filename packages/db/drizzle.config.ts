import { defineConfig } from 'drizzle-kit'

const databaseUrl =
  process.env['DATABASE_URL'] ??
  'postgres://climbcontest:climbcontest@localhost:5432/climbcontest'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})
