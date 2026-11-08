import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const migrationFiles = [
  'schema.sql', 'transactions.sql', 'market-batch-one.sql', 'market-batch-two.sql', 'market-batch-three.sql', 'market-storage.sql'
]

const guard = `DO $rehub_release$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role' AND rolbypassrls)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'REHUB_RELEASE_ROLE_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND left(c.relname, 6) = 'rehub_')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND left(t.typname, 6) = 'rehub_')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND left(p.proname, 6) = 'rehub_'
      AND NOT (p.proname = 'rehub_pg_compat_check' AND p.pronargs = 0)) THEN
    RAISE EXCEPTION 'REHUB_RELEASE_SCHEMA_ALREADY_PRESENT';
  END IF;
END;
$rehub_release$;`

export async function deploymentBody() {
  const bodies = await Promise.all(migrationFiles.map(async filename => {
    const source = (await readFile(new URL(filename, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
    const body = /^(?:--[^\n]*\n|\s)*BEGIN;\n([\s\S]*)\nCOMMIT;\s*$/.exec(source)?.[1]
    if (!body || /^(?:BEGIN|COMMIT|ROLLBACK);/m.test(body)) throw new Error(`INVALID_MIGRATION_TRANSACTION:${filename}`)
    return `-- ${filename}\n${body.trim()}\n`
  }))
  return `${guard}\n\n${bodies.join('\n')}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Emit DDL only. The versioned CloudBase runner must supply a verified single transaction.
  process.stdout.write(await deploymentBody())
}
