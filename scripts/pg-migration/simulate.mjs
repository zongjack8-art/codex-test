import { openLocalDatabase, safeFailure } from './local-db.mjs'
import { backupCounts, buildImportSql, legacyAppId, prepareSnapshot, withBackupCopy } from './migration.mjs'

const [sourceDir, ...extra] = process.argv.slice(2)
if (!sourceDir || extra.length) {
  console.error('用法: npm run simulate -- <备份目录>')
  process.exitCode = 1
} else {
  try {
    const report = await withBackupCopy(sourceDir, async snapshot => {
      const plan = prepareSnapshot(snapshot)
      const db = await openLocalDatabase()
      try {
        const sql = buildImportSql(plan)
        await db.exec(sql)
        await db.exec(sql)
        const { rows: [counts] } = await db.query(`SELECT
          (SELECT count(*)::int FROM public.rehub_legacy_documents) AS documents,
          (SELECT count(*)::int FROM public.rehub_wechat_identities WHERE app_id = $1) AS legacy_identities,
          (SELECT count(*)::int FROM public.rehub_wechat_identities WHERE app_id <> $1) AS other_identities,
          (SELECT count(*)::int FROM public.rehub_conversations c LEFT JOIN public.rehub_products p ON p.id = c.product_id
            WHERE p.id IS NULL) AS archived_conversations,
          (SELECT count(*)::int FROM public.rehub_orders o JOIN public.rehub_products p ON p.id = o.product_id
            WHERE o.status = 'pending' AND p.status = 'offline') AS offline_pending_orders`, [legacyAppId])
        if (counts.documents !== plan.recordCount || counts.legacy_identities !== backupCounts.users ||
          counts.other_identities !== 0 || counts.offline_pending_orders !== plan.offlinePendingOrders) {
          throw new Error('POST_IMPORT_VALIDATION_FAILED')
        }
        return { collections: backupCounts, ...counts, archived_product_refs: plan.archivedProductRefs, replay: 'identical' }
      } finally {
        await db.close()
      }
    })
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(safeFailure(error))
    process.exitCode = 1
  }
}
