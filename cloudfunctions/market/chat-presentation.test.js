const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTs(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', relativePath), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const moduleLike = { exports: {} }
  new Function('module', 'exports', code)(moduleLike, moduleLike.exports)
  return moduleLike.exports
}

const { mergeMessages, newIncomingMessages, sendContent, formatMessageDay, formatConversationTime, groupMessagesByDay, canOpenConversationProduct } = loadTs('utils/chatPresentation.ts')
const { createVisiblePoller } = loadTs('utils/visiblePoller.ts')
const message = (id, createdAt, senderId = 'buyer', conversationId = 'conversation-1', content = id) => ({ id, createdAt, senderId, conversationId, content, type: 'text' })
const date = (year, month, day, hour = 10) => new Date(year, month - 1, day, hour).getTime()

test('消息按创建时间升序、按 ID 去重，服务端同 ID 版本优先', () => {
  const existing = [message('new', 300), message('same', 100, 'buyer', 'conversation-1', 'old')]
  const server = [message('same', 200, 'buyer', 'conversation-1', 'latest'), message('middle', 250)]
  const merged = mergeMessages(existing, server)
  assert.deepEqual(merged.map(item => item.id), ['same', 'middle', 'new'])
  assert.equal(merged[0].content, 'latest')
  assert.equal(mergeMessages(merged, server).length, 3)
  assert.equal(mergeMessages([message('sent', 1)], [message('sent', 1)]).length, 1)
})

test('失败重试使用保存的旧消息，空白输入不能发送', () => {
  const failedText = sendContent('  原消息  ')
  assert.equal(failedText, '原消息')
  assert.equal(sendContent('后来输入的新草稿', failedText), '原消息')
  assert.equal(sendContent(' \n  '), '')
})

test('同一天只分一组，昨天、跨天和跨年标签正确', () => {
  const now = date(2026, 1, 1, 20)
  const rows = [message('a', date(2025, 12, 30)), message('b', date(2025, 12, 31, 9)), message('c', date(2025, 12, 31, 18)), message('d', date(2026, 1, 1))]
  const groups = groupMessagesByDay(rows, now)
  assert.deepEqual(groups.map(group => group.label), ['2025年12月30日', '昨天', '今天'])
  assert.deepEqual(groups[1].messages.map(item => item.id), ['b', 'c'])
  assert.equal(formatMessageDay(date(2026, 10, 15), date(2026, 10, 16)), '昨天')
  assert.equal(formatMessageDay(date(2026, 10, 10), date(2026, 10, 16)), '10月10日')
  assert.equal(formatConversationTime(date(2025, 12, 31), now), '昨天')
  assert.equal(formatConversationTime(date(2025, 12, 30), now), '2025/12/30')
  assert.equal(formatConversationTime(date(2026, 10, 10), date(2026, 10, 16)), '10月10日')
  assert.match(formatConversationTime(date(2026, 10, 16), date(2026, 10, 16, 20)), /^\d\d:\d\d$/)
})

test('仅可见的当前会话的新对方消息需要标记已读', () => {
  const known = [message('old', 1, 'seller')]
  const incoming = [message('old', 1, 'seller'), message('mine', 2, 'buyer'), message('other-chat', 3, 'seller', 'conversation-2'), message('new', 4, 'seller')]
  assert.deepEqual(newIncomingMessages(known, incoming, 'buyer', true, 'conversation-1').map(item => item.id), ['new'])
  assert.deepEqual(newIncomingMessages(known, incoming, 'buyer', false, 'conversation-1'), [])
  assert.deepEqual(newIncomingMessages(known, incoming, 'buyer', true, 'conversation-3'), [])
})

test('聊天商品在售、交易中、已售可打开，已下架或删除不可打开', () => {
  for (const status of ['selling', 'reserved', 'sold']) assert.equal(canOpenConversationProduct(status), true)
  for (const status of ['offline', 'deleted']) assert.equal(canOpenConversationProduct(status), false)
})

test('聊天页 6 秒消息轮询可见时运行，隐藏后停止；在途请求不会重叠', async () => {
  let tick
  let cleared = 0
  const delays = []
  const scheduler = {
    setInterval(callback, delay) { tick = callback; delays.push(delay); return 1 },
    clearInterval() { tick = null; cleared++ }
  }
  let finish
  let calls = 0
  const poller = createVisiblePoller(async isCurrent => {
    calls++
    await new Promise(resolve => { finish = resolve })
    assert.equal(isCurrent(), false)
  }, 6000, scheduler)
  poller.start()
  poller.start()
  assert.deepEqual(delays, [6000])
  assert.equal(calls, 1)
  tick(); assert.equal(calls, 1)
  poller.stop()
  assert.equal(cleared, 1)
  assert.equal(tick, null)
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
})
