import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { oldApp, newApp, school, prefix, jpg, withMarket, product, seedProducts } from './market-test-support.mjs'

async function enableAdmin(db, app = oldApp, openId = 'admin') {
  await db.query(`INSERT INTO public.rehub_admins(id,app_id,open_id,role,enabled,created_at)
    VALUES (gen_random_uuid()::text,$1,$2,'admin',true,1)`, [app, openId])
}

test('评价资格、原子提交、重复评价错误与卖家评分', async () => {
  await withMarket(async ({ db, as, ok, call, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 1)
    as(newApp, 'buyer')
    const { id: orderId } = await ok('createOrder', { productId: 'item-1' })
    await rejected('createReview', { orderId, rating: 6 }, 'INVALID_INPUT')
    await rejected('createReview', { orderId, rating: 5 }, 'INVALID_STATE')
    assert.deepEqual(await ok('getOrderReview', { orderId }), { reviewed: false })
    as(newApp, 'seller')
    await ok('confirmOrder', { id: orderId })
    await ok('completeOrder', { id: orderId })
    await rejected('createReview', { orderId, rating: 5 }, 'FORBIDDEN')
    as(oldApp, 'buyer')
    await ok('login')
    await rejected('getOrderReview', { orderId }, 'FORBIDDEN')
    await rejected('createReview', { orderId, rating: 5, buyerId: 'buyer' }, 'FORBIDDEN')
    as(newApp, 'buyer')
    const input = { orderId, rating: 5, content: ' 交易顺利 ' }
    const responses = await Promise.all([call('createReview', input), call('createReview', input)])
    assert.equal(responses.filter(result => result.ok).length, 1)
    assert.equal(responses.find(result => !result.ok).error.code, 'ALREADY_REVIEWED')
    await rejected('createReview', { ...input, rating: 1 }, 'ALREADY_REVIEWED')
    const { review } = await ok('getOrderReview', { orderId })
    assert.deepEqual(review, { rating: 5, content: '交易顺利', createdAt: review.createdAt })
    assert.equal(typeof review.createdAt, 'number')
    assert.deepEqual(await ok('getSellerReviewSummary', { sellerId: seller.id }), { averageRating: 5, reviewCount: 1 })
    assert.deepEqual(await ok('listSellerReviews', { sellerId: seller.id }), [review])
    assert.deepEqual(await ok('getSellerReviewSummary', { sellerId: 'none' }), { averageRating: 0, reviewCount: 0 })
    as(newApp, 'seller')
    await ok('deleteProduct', { id: 'item-1' })
    assert.deepEqual(await ok('getOrderReview', { orderId }), { reviewed: true, review })
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.rehub_reviews')).rows[0].n, 1)
  })
})

test('举报去重、限额、私有记录与新旧 AppID 管理员隔离', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 11)
    const report = { productId: 'item-1', reason: 'fraud', description: '仅处理者可见' }
    await rejected('createReport', { report }, 'INVALID_INPUT')
    as(oldApp, 'admin')
    const admin = await ok('login')
    await enableAdmin(db)
    assert.deepEqual(await ok('getAdminStatus'), { isAdmin: true })
    as(newApp, 'admin')
    const reporter = await ok('login')
    assert.notEqual(reporter.id, admin.id)
    assert.deepEqual(await ok('getAdminStatus', { isAdmin: true, APPID: oldApp, OPENID: 'admin' }), { isAdmin: false })
    const first = await Promise.all([ok('createReport', { report }), ok('createReport', { report })])
    assert.deepEqual(first.map(result => result.created).sort(), [false, true])
    for (let i = 2; i <= 10; i++) await ok('createReport', { report: { ...report, productId: `item-${i}` } })
    await rejected('createReport', { report: { ...report, productId: 'item-11' } }, 'RATE_LIMITED')
    const own = await ok('getAdminStatus', { includeMyReports: true })
    const row = own.myReports.find(item => item.productId === 'item-1')
    assert.equal(row.description, report.description)
    assert.equal(own.myReports.length, 10)
    assert.equal(Object.hasOwn(row, 'reporterId'), false)
    for (const action of ['adminListProducts', 'adminListReports', 'getAdminNotificationSummary', 'adminResolveReport', 'adminTakeDownProduct']) {
      await rejected(action, { id: row.id, isAdmin: true, appId: oldApp, resolution: 'dismiss' }, 'FORBIDDEN')
    }
    as(newApp, 'another-user')
    await ok('login')
    assert.deepEqual(await ok('getAdminStatus', { includeMyReports: true, reporterId: reporter.id }), { isAdmin: false, myReports: [] })
    as(oldApp, 'admin')
    assert.deepEqual(await ok('getAdminNotificationSummary'), { pendingReports: 10 })
    assert.equal((await ok('adminListReports')).find(item => item.id === row.id).reporterId, reporter.id)
    assert.equal((await ok('adminListProducts')).length, 11)
    await ok('adminResolveReport', { id: row.id, resolution: 'dismiss' })
    await rejected('adminResolveReport', { id: row.id, resolution: 'takedown' }, 'INVALID_STATE')
    assert.deepEqual(await ok('getAdminNotificationSummary'), { pendingReports: 9 })
    as(newApp, 'admin')
    const handled = (await ok('getAdminStatus', { includeMyReports: true })).myReports.find(item => item.id === row.id)
    assert.equal(handled.status, 'dismissed')
    assert.equal(handled.resolution, 'dismiss')
    assert.equal(typeof handled.resolvedAt, 'number')
  })
})

test('举报下架和处理记录同事务提交，已下架商品保留首笔审核记录', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 2)
    as(newApp, 'reporter')
    for (const id of ['item-1', 'item-2']) await ok('createReport', { report: { productId: id, reason: 'other' } })
    as(oldApp, 'admin')
    const admin = await ok('login')
    await enableAdmin(db)
    const rows = await ok('adminListReports')
    const id = rows.find(row => row.productId === 'item-1').id
    await db.exec(`CREATE FUNCTION public.fail_report_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'INJECTED_WRITE_FAILURE'; END; $$;
      CREATE TRIGGER fail_report_write BEFORE UPDATE ON public.rehub_reports
      FOR EACH ROW EXECUTE FUNCTION public.fail_report_write();`)
    await rejected('adminResolveReport', { id, resolution: 'takedown' }, 'SERVER_ERROR')
    assert.equal((await ok('getProduct', { id: 'item-1' })).status, 'selling')
    assert.equal((await ok('adminListReports')).find(row => row.id === id).status, 'pending')
    await db.exec('DROP TRIGGER fail_report_write ON public.rehub_reports')
    assert.deepEqual(await ok('adminResolveReport', { id, resolution: 'takedown' }), { resolved: true })
    assert.deepEqual((await db.query(`SELECT status, moderated_by FROM public.rehub_products WHERE id='item-1'`)).rows[0],
      { status: 'offline', moderated_by: admin.id })
    assert.deepEqual((await db.query(`SELECT status, resolved_by FROM public.rehub_reports WHERE id=$1`, [id])).rows[0],
      { status: 'resolved', resolved_by: admin.id })
    assert.deepEqual(await ok('adminTakeDownProduct', { id: 'item-2', reason: '首次审核' }), { takenDown: true })
    await rejected('adminTakeDownProduct', { id: 'item-2', reason: '再次审核' }, 'INVALID_STATE')
    await ok('adminResolveReport', { id: rows.find(row => row.productId === 'item-2').id, resolution: 'takedown' })
    assert.equal((await ok('getProduct', { id: 'item-2' })).moderationReason, '首次审核')
  })
})

test('上传失败和部分删除失败留下补偿任务，只由同一身份重试', async () => {
  let uploadFails = true
  let failedFile
  await withMarket(async ({ db, as, ok, rejected, files, deletions }) => {
    const owner = await ok('login')
    const incoming = suffix => `${prefix}incoming/${owner.id}/${suffix}.jpg`
    const first = incoming('uploadfirst')
    failedFile = first
    files.set(first, jpg)
    await rejected('finalizeImage', { fileID: first }, 'SERVER_ERROR')
    const pending = await db.query('SELECT file_id, attempts FROM public.rehub_incoming_cleanup')
    assert.deepEqual(pending.rows, [{ file_id: first, attempts: 1 }])
    const uncertain = (await db.query(`SELECT file_ids FROM public.rehub_reports WHERE type='image_cleanup'`)).rows[0].file_ids
    assert.equal(uncertain.length, 1)
    assert.ok(uncertain[0].startsWith(`${prefix}images/${owner.id}/`))
    await db.exec('UPDATE public.rehub_incoming_cleanup SET next_attempt_at=0')
    as(oldApp, 'seller')
    const other = await ok('login')
    await rejected('finalizeImage', { fileID: first }, 'INVALID_IMAGE')
    uploadFails = false
    const otherUpload = `${prefix}incoming/${other.id}/otherfile.jpg`
    files.set(otherUpload, jpg)
    await ok('finalizeImage', { fileID: otherUpload })
    assert.equal(deletions.filter(id => id === first).length, 1)
    as(newApp, 'seller')
    const next = incoming('uploadsecond')
    failedFile = next
    files.set(next, jpg)
    const saved = await ok('finalizeImage', { fileID: next, purpose: 'avatar' })
    assert.match(saved.fileID, new RegExp(`/avatars/${owner.id}/`))
    assert.equal(deletions.filter(id => id === first).length, 2)
    assert.deepEqual((await db.query('SELECT file_id, attempts FROM public.rehub_incoming_cleanup')).rows,
      [{ file_id: next, attempts: 1 }])
    await db.exec('UPDATE public.rehub_incoming_cleanup SET next_attempt_at=0')
    failedFile = undefined
    const last = incoming('uploadthird')
    files.set(last, jpg)
    await ok('finalizeImage', { fileID: last })
    assert.equal(deletions.filter(id => id === next).length, 2)
    assert.deepEqual((await db.query('SELECT file_id FROM public.rehub_incoming_cleanup')).rows, [])
  }, {
    upload({ cloudPath }) {
      if (uploadFails) throw new Error('simulated upload failure')
      return { fileID: prefix + cloudPath }
    },
    remove(ids) {
      return { fileList: ids.map(fileID => ({ fileID, status: fileID === failedFile ? -1 : 0 })) }
    }
  })
})

test('图片大小、文件头及归属校验，正式清理预检保护订单和聊天快照', async () => {
  await withMarket(async ({ db, as, ok, rejected, files, deletions }) => {
    const seller = await ok('login')
    const incoming = suffix => `${prefix}incoming/${seller.id}/${suffix}.jpg`
    const invalid = incoming('badimagefile')
    const large = incoming('oversizefile')
    files.set(invalid, Buffer.from('plain text'))
    files.set(large, Buffer.alloc(5 * 1024 * 1024 + 1))
    await rejected('finalizeImage', { fileID: invalid }, 'INVALID_IMAGE')
    await rejected('finalizeImage', { fileID: large }, 'INVALID_IMAGE')
    await rejected('finalizeImage', { fileID: invalid.replace(prefix, 'cloud://other/') }, 'INVALID_IMAGE')
    const illegalFormal = `${prefix}images/${seller.id}/forgedimg.jpg`
    files.set(illegalFormal, Buffer.from('not an image'))
    await rejected('createProduct', { product: product([illegalFormal]) }, 'INVALID_IMAGE')

    const upload = async suffix => {
      const fileID = incoming(suffix)
      files.set(fileID, jpg)
      return (await ok('finalizeImage', { fileID })).fileID
    }
    const snapshot = await upload('validimage')
    const unused = await upload('unusedimage')
    const { _id: productId } = await ok('createProduct', { product: product([snapshot, unused]) })
    as(newApp, 'buyer')
    await ok('createOrder', { productId })
    await ok('startConversation', { productId })
    as(newApp, 'seller')
    await ok('deleteProduct', { id: productId })
    const historical = 'cloud://legacy-bucket/images/old-user/archived.jpg'
    const archivedMapping = `${prefix}images/${seller.id}/${'a'.repeat(32)}.jpg`
    await db.query(`INSERT INTO public.rehub_reports(id,type,file_ids,cleanup_kind,reason,school,status,created_at,updated_at)
      VALUES ('legacy-cleanup','image_cleanup',ARRAY[$1,$2],'discarded_upload','待恢复',$3,'pending',1,1)`,
    [historical, archivedMapping, school])
    await db.query(`INSERT INTO public.rehub_legacy_documents(source_app_id,collection,document_id,payload)
      VALUES ($1,'products','archived-fixture',jsonb_build_object('images',jsonb_build_array($2::text)))`, [oldApp, archivedMapping])
    const plan = await readFile(new URL('formal-cleanup-plan.sql', import.meta.url), 'utf8')
    const states = new Map((await db.query(plan, [prefix])).rows.map(row => [row.file_id, row.disposition]))
    assert.equal(states.get(snapshot), 'referenced')
    assert.equal(states.get(unused), 'review_required')
    assert.equal(states.get(historical), 'legacy_or_unverified')
    assert.equal(states.get(archivedMapping), 'referenced')
    assert.ok(deletions.every(fileID => fileID.startsWith(`${prefix}incoming/`)))
  })
})

test('即使临时赋予 EXECUTE，客户端角色也不能调用管理、私有举报或清理 RPC', async () => {
  await withMarket(async ({ db }) => {
    await db.exec(`GRANT EXECUTE ON FUNCTION public.rehub_market_admin_identity(text,text),
      public.rehub_market_reports(text,text,text,text), public.rehub_market_claim_incoming(text,text,text),
      public.rehub_market_finish_incoming(text,text,uuid,boolean) TO anon, authenticated`)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      try {
        await assert.rejects(db.query('SELECT public.rehub_market_admin_identity($1,$2)', [oldApp, 'admin']), { code: '42501' })
        await assert.rejects(db.query('SELECT public.rehub_market_reports($1,$2,$3,$4)', ['forged', oldApp, 'admin', school]), { code: '42501' })
        await assert.rejects(db.query(`SELECT public.rehub_market_claim_incoming('forged',$1,NULL)`, [prefix]), { code: '42501' })
        await assert.rejects(db.query(`SELECT public.rehub_market_finish_incoming('forged','file',NULL,true)`), { code: '42501' })
        await assert.rejects(db.query('SELECT * FROM public.rehub_incoming_cleanup'), { code: '42501' })
      } finally { await db.exec('RESET ROLE') }
    }
  })
})
