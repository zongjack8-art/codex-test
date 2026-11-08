import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import test from 'node:test'
import { oldApp, newApp, school, prefix, jpg, withMarket, product, seedProducts } from './market-test-support.mjs'

const require = createRequire(import.meta.url)

test('PG 入口先验证可信身份，登录和资料更新按 AppID 隔离', async () => {
  await withMarket(async ({ db, as, ok, rejected, calls, files }) => {
    as(newApp, undefined)
    await rejected('listProducts', { OPENID: 'forged' }, 'UNAUTHENTICATED')
    as('wx1234567890abcdef', 'seller')
    await rejected('login', { appId: newApp }, 'FORBIDDEN')
    as(newApp, 'seller', { FROM_APPID: oldApp })
    await rejected('login', {}, 'FORBIDDEN')
    assert.equal(calls.length, 0)

    as(oldApp, 'same-openid')
    const old = await ok('login')
    await db.query(`UPDATE public.rehub_users SET school='旧学校', campus='北校区', avatar='🎓' WHERE id=$1`, [old.id])
    assert.deepEqual(await ok('login'), { ...old, campus: '校内', avatar: '同' })
    const avatar = `${prefix}avatars/${old.id}/avatar123.jpg`
    files.set(avatar, jpg)
    const profile = await ok('updateProfile', { profile: { id: 'forged', nickname: '旧身份', campus: '图书馆', bio: '简介', avatar } })
    assert.deepEqual(profile, { id: old.id, nickname: '旧身份', avatar, campus: '图书馆', bio: '简介', school })

    as(newApp, 'same-openid')
    const fresh = await ok('login', { userId: old.id, OPENID: 'forged' })
    assert.notEqual(fresh.id, old.id)
    assert.equal(fresh.nickname, '校园同学')
    await rejected('updateProfile', { profile: { nickname: '越权', campus: '校内', avatar } }, 'INVALID_INPUT')
    assert.deepEqual(await ok('login'), fresh)
    await rejected('unknownAction', {}, 'INVALID_ACTION')
    as(oldApp, 'same-openid')
    assert.deepEqual(await ok('login'), profile)
  })
})

test('发布、查询、编辑、上下架和删除保留契约，另一 AppID 无权修改', async () => {
  await withMarket(async ({ db, sdk, as, ok, rejected, files }) => {
    const seller = await ok('login')
    const file = `${prefix}images/${seller.id}/product123.jpg`
    files.set(file, jpg)
    await rejected('createProduct', { product: product([file.replace(prefix, 'cloud://other/')]) }, 'INVALID_INPUT')
    const created = await ok('createProduct', { product: product([file], { sellerId: 'forged', status: 'sold', school: '外校' }) })
    assert.equal(created.sellerId, seller.id)
    assert.equal(created.status, 'selling')
    assert.equal(created.school, school)
    assert.deepEqual(await ok('getProduct', { id: created._id }), { ...created, viewerIsSeller: true })
    assert.deepEqual((await ok('getMyProducts')).map(item => item._id), [created._id])
    as(oldApp, 'seller')
    const buyer = await ok('login')
    assert.equal((await ok('getProduct', { id: created._id })).viewerIsSeller, false)
    assert.deepEqual(await ok('getMyProducts'), [])
    await rejected('updateProduct', { id: created._id, product: product([file]) }, 'FORBIDDEN')
    await rejected('deleteProduct', { id: created._id }, 'FORBIDDEN')
    await rejected('setProductStatus', { id: created._id, status: 'offline' }, 'FORBIDDEN')
    as(newApp, 'seller')

    const legacy = 'cloud://legacy-bucket/images/historical-seller/image123.jpg'
    await db.query('UPDATE public.rehub_products SET images=$1 WHERE id=$2', [[legacy], created._id])
    const updated = await ok('updateProduct', { id: created._id, product: product([legacy], { title: '编辑后的标题' }) })
    assert.equal(updated.title, '编辑后的标题')
    assert.deepEqual(updated.images, [legacy])
    assert.deepEqual(await ok('setProductStatus', { id: created._id, status: 'offline' }), { status: 'offline' })
    assert.deepEqual(await ok('setProductStatus', { id: created._id, status: 'selling' }), { status: 'selling' })
    await rejected('setProductStatus', { id: created._id, status: 'reserved' }, 'INVALID_INPUT')
    const order = await sdk.rpc('rehub_create_order', { p_actor_id: buyer.id, p_product_id: created._id })
    assert.equal(order.error, null)
    const transition = action => sdk.rpc('rehub_transition_order', { p_actor_id: seller.id, p_order_id: order.data, p_action: action })
    assert.equal((await transition('confirm')).error, null)
    assert.equal((await ok('getProduct', { id: created._id })).status, 'reserved')
    await rejected('updateProduct', { id: created._id, product: product([legacy]) }, 'INVALID_STATE')
    await rejected('deleteProduct', { id: created._id }, 'INVALID_STATE')
    assert.equal((await transition('cancel')).error, null)
    await ok('setProductStatus', { id: created._id, status: 'sold' })
    await rejected('updateProduct', { id: created._id, product: product([legacy]) }, 'INVALID_STATE')
    assert.deepEqual(await ok('deleteProduct', { id: created._id }), { deleted: true })
    assert.equal(await ok('getProduct', { id: created._id }), null)
    assert.deepEqual(await ok('getMyProducts'), [])
    const archived = await db.query(`SELECT p.status FROM public.rehub_product_refs r JOIN public.rehub_products p USING (id) WHERE r.id = $1`, [created._id])
    assert.deepEqual(archived.rows, [{ status: 'deleted' }])
  })
})

test('搜索保持字面关键词、分类、价格边界、排序和公开 50 条上限，我的发布跨页', async () => {
  await withMarket(async ({ db, ok, rejected, calls }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id)
    await db.exec(`UPDATE public.rehub_products SET status='offline', moderation_status='blocked' WHERE id='item-105';
      UPDATE public.rehub_products SET school='外校' WHERE id='item-104';
      UPDATE public.rehub_products SET status='sold' WHERE id='item-103'`)
    assert.equal(await ok('getProduct', { id: 'item-104' }), null)
    await rejected('setProductStatus', { id: 'item-105', status: 'selling' }, 'FORBIDDEN')
    const list = await ok('listProducts', { filters: { offset: 50 } })
    assert.equal(list.length, 50)
    assert.equal(list[0]._id, 'item-102')
    assert.equal(list[49]._id, 'item-53')
    assert.equal(list.every(row => row.seller.id === '' && !Object.hasOwn(row, 'sellerId')), true)
    const cases = [
      [{ keyword: '  case (100%_BOOK)  ' }, ['item-3', 'item-2']],
      [{ keyword: '100xxbook' }, []],
      [{ keyword: 'case', category: 'books' }, ['item-2']],
      [{ minPrice: 2, maxPrice: 5, sort: 'priceAsc' }, ['item-2', 'item-3', 'item-4']],
      [{ minPrice: 2, maxPrice: 5, sort: 'priceDesc' }, ['item-4', 'item-3', 'item-2']],
      [{ minPrice: 103, school: '外校' }, []]
    ]
    for (const [filters, ids] of cases) assert.deepEqual((await ok('listProducts', { filters })).map(row => row._id), ids)
    await rejected('listProducts', { filters: { minPrice: 3, maxPrice: 2 } }, 'INVALID_INPUT')
    await rejected('listProducts', { filters: { category: 'unknown' } }, 'INVALID_INPUT')
    const own = await ok('getMyProducts')
    assert.equal(own.length, 105)
    assert.equal(own.at(-1)._id, 'item-1')
    assert.deepEqual(calls.filter(call => call.table === 'rehub_products' && call.limit === 100).map(call => call.offset), [0, 100])
  })
})

test('收藏幂等、分用户、隐藏下架商品，商品删除清除收藏', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 3)
    as(newApp, 'buyer')
    const buyer = await ok('login')
    await rejected('setFavorite', { id: 'item-1', favorited: 'true' }, 'INVALID_INPUT')
    for (let i = 0; i < 2; i++) assert.deepEqual(await ok('setFavorite', { id: 'item-1', favorited: true }), { favorited: true })
    assert.deepEqual(await ok('getFavoriteIds'), ['item-1'])
    assert.deepEqual((await ok('getFavorites')).map(row => row._id), ['item-1'])
    await ok('setFavorite', { id: 'item-2', favorited: true })
    await db.exec(`UPDATE public.rehub_products SET status='offline' WHERE id='item-2'`)
    assert.deepEqual((await ok('getFavorites')).map(row => row._id), ['item-1'])
    assert.equal((await ok('getFavoriteIds')).includes('item-2'), true)
    await rejected('setFavorite', { id: 'item-2', favorited: true }, 'NOT_FOUND')
    as(oldApp, 'buyer')
    assert.deepEqual(await ok('getFavoriteIds', { userId: buyer.id }), [])
    assert.deepEqual(await ok('setFavorite', { id: 'item-1', favorited: false }), { favorited: false })
    as(newApp, 'buyer')
    for (let i = 0; i < 2; i++) await ok('setFavorite', { id: 'item-2', favorited: false })
    assert.deepEqual(await ok('getFavoriteIds'), ['item-1'])
    as(newApp, 'seller')
    await ok('deleteProduct', { id: 'item-1' })
    as(newApp, 'buyer')
    assert.deepEqual(await ok('getFavoriteIds'), [])
  })
})

test('最近浏览按访问置顶、最多 50 条、过滤隐藏商品并隔离清理', async () => {
  await withMarket(async ({ db, as, ok, rejected }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 52)
    as(newApp, 'viewer')
    const viewer = await ok('login')
    for (let n = 1; n <= 51; n++) assert.deepEqual(await ok('recordProductView', { productId: `item-${n}` }), { recorded: true })
    await ok('recordProductView', { productId: 'item-2' })
    let history = await ok('listRecentViews')
    assert.equal(history.length, 50)
    assert.equal(history[0]._id, 'item-2')
    assert.equal(history.some(row => row._id === 'item-1'), false)
    await db.exec(`UPDATE public.rehub_products SET status='sold' WHERE id='item-51';
      UPDATE public.rehub_products SET status='offline' WHERE id='item-2'`)
    await rejected('recordProductView', { productId: 'item-2' }, 'NOT_FOUND')
    history = await ok('listRecentViews')
    assert.equal(history[0]._id, 'item-51')
    assert.equal(history[0].status, 'sold')
    assert.equal(history.length, 49)
    as(oldApp, 'viewer')
    await ok('recordProductView', { productId: 'item-52', userId: viewer.id })
    assert.deepEqual(await ok('clearRecentViews', { userId: viewer.id }), { cleared: true })
    assert.deepEqual(await ok('listRecentViews'), [])
    as(newApp, 'viewer')
    assert.equal((await ok('listRecentViews')).length, 49)
    await ok('clearRecentViews')
    assert.deepEqual(await ok('listRecentViews'), [])
  })
})

test('图片 action 校验当前桶与用户路径，保护引用中的正式文件', async () => {
  await withMarket(async ({ db, ok, rejected, files, uploads, deletions }) => {
    const seller = await ok('login')
    const input = `${prefix}incoming/${seller.id}/upload123.jpg`
    files.set(input, jpg)
    await rejected('finalizeImage', { fileID: input.replace(prefix, 'cloud://other/') }, 'INVALID_IMAGE')
    const { fileID } = await ok('finalizeImage', { fileID: input })
    assert.equal(fileID, prefix + uploads[0])
    assert.deepEqual(deletions, [input])
    const item = await ok('createProduct', { product: product([fileID]) })
    const unused = `${prefix}images/${seller.id}/unused123.jpg`
    for (let i = 0; i < 2; i++) assert.deepEqual(await ok('discardImages', { fileIDs: [fileID, unused] }), { discarded: true })
    await rejected('discardImages', { fileIDs: [fileID.replace(prefix, 'cloud://other/')] }, 'INVALID_IMAGE')
    const queued = await db.query(`SELECT file_ids, cleanup_kind FROM public.rehub_reports WHERE type='image_cleanup'`)
    assert.deepEqual(queued.rows, [{ file_ids: [unused], cleanup_kind: 'discarded_upload' }])
    await ok('deleteProduct', { id: item._id })
    assert.deepEqual((await db.query(`SELECT file_ids FROM public.rehub_reports WHERE cleanup_kind='product'`)).rows, [{ file_ids: [fileID] }])
    assert.deepEqual(deletions, [input])
  })
})

test('即使给匿名角色 RPC 执行权，函数内角色检查仍拒绝访问', async () => {
  await withMarket(async ({ db }) => {
    await db.exec('GRANT EXECUTE ON FUNCTION public.rehub_market_login(text,text,text,text) TO anon; SET ROLE anon')
    try {
      await assert.rejects(db.query(`SELECT public.rehub_market_login($1,'fake',$2,'校内')`, [newApp, school]), { code: '42501' })
      await assert.rejects(db.query('SELECT * FROM public.rehub_wechat_identities'), { code: '42501' })
    } finally { await db.exec('RESET ROLE') }
  })
})

test('发布上限和收藏上限由事务检查，已收藏时重复保存仍成功', async () => {
  await withMarket(async ({ db, as, ok, rejected, files }) => {
    const seller = await ok('login')
    await seedProducts(db, seller.id, 501)
    await db.exec(`UPDATE public.rehub_products SET created_at = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
      WHERE id IN (SELECT 'item-' || n FROM generate_series(1, 20) n)`)
    const image = `${prefix}images/${seller.id}/listing123.jpg`
    files.set(image, jpg)
    await rejected('createProduct', { product: product([image]) }, 'RATE_LIMITED')
    as(newApp, 'buyer')
    const buyer = await ok('login')
    await db.query(`INSERT INTO public.rehub_favorites(id, user_id, product_id, created_at)
      SELECT 'fav-' || n, $1, 'item-' || n, n FROM generate_series(1, 500) n`, [buyer.id])
    assert.equal((await ok('getFavoriteIds')).length, 500)
    assert.equal((await ok('getFavorites')).length, 50)
    assert.deepEqual(await ok('setFavorite', { id: 'item-500', favorited: true }), { favorited: true })
    await rejected('setFavorite', { id: 'item-501', favorited: true }, 'RATE_LIMITED')
  })
})

test('market 正常入口显式启用 PG 时只使用当前环境 rdb()', async () => {
  await withMarket(async ({ sdk }) => {
    const entry = require.resolve('../../cloudfunctions/market/index.js')
    const originalLoad = Module._load
    const oldBackend = process.env.REHUB_MARKET_BACKEND
    const oldApps = process.env.REHUB_MARKET_PG_APP_IDS
    const currentEnv = Symbol('current env')
    const initCalls = []
    process.env.REHUB_MARKET_BACKEND = 'postgresql'
    process.env.REHUB_MARKET_PG_APP_IDS = newApp
    Module._load = function (request, parent, isMain) {
      if (request === 'wx-server-sdk') return {
        DYNAMIC_CURRENT_ENV: 'wx-current', init(options) { initCalls.push(options) },
        getWXContext() { assert.fail('PG entry attempted to read reusable process identity') },
        database() { assert.fail('PG entry attempted to access the legacy database') }
      }
      if (request === '@cloudbase/js-sdk') return {
        SYMBOL_CURRENT_ENV: currentEnv,
        parseContext: context => ({ environment: JSON.parse(context.environment || '{}') }),
        init(options) { initCalls.push(options); return { rdb: () => sdk } }
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    try {
      const { main } = require(entry)
      const invocation = { environment: JSON.stringify({ WX_APPID: newApp, WX_OPENID: 'test-login' }) }
      const response = await main({ action: 'login', APPID: oldApp, OPENID: 'forged' }, invocation)
      assert.equal(response.ok, true)
      assert.equal(response.data.nickname, '校园同学')
      assert.equal((await main({ action: 'login', ...invocation }, {})).error?.code, 'UNAUTHENTICATED')
      assert.equal((await main({ action: 'login' }, { environment: '{' })).error?.code, 'UNAUTHENTICATED')
      const shared = { environment: JSON.stringify({ WX_APPID: newApp, WX_OPENID: 'test-login', WX_FROM_APPID: oldApp }) }
      assert.equal((await main({ action: 'login' }, shared)).error?.code, 'FORBIDDEN')
      assert.deepEqual(initCalls, [{ env: 'wx-current' }, { env: currentEnv, timeout: 8000 }])
    } finally {
      Module._load = originalLoad
      delete require.cache[entry]
      if (oldBackend === undefined) delete process.env.REHUB_MARKET_BACKEND
      else process.env.REHUB_MARKET_BACKEND = oldBackend
      if (oldApps === undefined) delete process.env.REHUB_MARKET_PG_APP_IDS
      else process.env.REHUB_MARKET_PG_APP_IDS = oldApps
    }
  })
})
