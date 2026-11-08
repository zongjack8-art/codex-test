import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

export async function openLocalDatabase({ empty = false } = {}) {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;`)
    if (!empty) {
      for (const filename of ['schema.sql', 'transactions.sql']) {
        await db.exec(await readFile(new URL(filename, import.meta.url), 'utf8'))
      }
    }
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

export function safeFailure(error) {
  if (/^[A-Z_]+(?::[a-zA-Z_]+)?$/.test(error?.message ?? '')) return error.message
  if (/^[0-9A-Z]{5}$/.test(error?.code ?? '')) {
    return /^[a-z_]+$/.test(error?.constraint ?? '') ? `${error.code}:${error.constraint}` : error.code
  }
  return 'LOCAL_MIGRATION_FAILED'
}
