const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../src/utils/visiblePoller.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const pollerModule = { exports: {} }
new Function('module', 'exports', code)(pollerModule, pollerModule.exports)
const { createVisiblePoller } = pollerModule.exports

function clock() {
  let nextId = 0
  const timers = new Map()
  return {
    timers,
    scheduler: {
      setInterval(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id },
      clearInterval(id) { timers.delete(id) }
    },
    tick() { for (const timer of [...timers.values()]) timer.callback() }
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('首次立即刷新，5 秒轮询；一次失败保留上次数字并继续重试', async () => {
  const fake = clock()
  let value = 0
  let calls = 0
  const poller = createVisiblePoller(async isCurrent => {
    calls++
    if (calls === 2) throw new Error('temporary network error')
    if (isCurrent()) value = calls
  }, 5000, fake.scheduler)
  poller.start()
  assert.equal(value, 1)
  assert.equal([...fake.timers.values()][0].delay, 5000)
  poller.start()
  assert.equal(fake.timers.size, 1)
  await settle()
  fake.tick(); await settle()
  assert.equal(value, 1)
  fake.tick(); await settle()
  assert.equal(value, 3)
  poller.stop()
  assert.equal(fake.timers.size, 0)
})

test('多次页面 show/hide 只保留一个 interval，隐藏和销毁后无定时刷新', async () => {
  const fake = clock()
  let calls = 0
  const poller = createVisiblePoller(async () => { calls++ }, 5000, fake.scheduler)
  poller.start(); poller.start()
  assert.equal(fake.timers.size, 1)
  poller.stop(); poller.stop()
  assert.equal(fake.timers.size, 0)
  fake.tick(); await settle()
  assert.equal(calls, 1)
  poller.start()
  assert.equal(calls, 2)
  assert.equal(fake.timers.size, 1)
  poller.stop()
  assert.equal(fake.timers.size, 0)
})

test('页面返回后的新请求不会被隐藏前的慢请求覆盖', async () => {
  const fake = clock()
  const pending = []
  let value = 0
  const poller = createVisiblePoller(async isCurrent => {
    const next = await new Promise(resolve => pending.push(resolve))
    if (isCurrent()) value = next
  }, 5000, fake.scheduler)
  poller.start()
  poller.stop()
  poller.start()
  assert.equal(pending.length, 2)
  pending[1](2); await settle()
  pending[0](1); await settle()
  assert.equal(value, 2)
  poller.stop()
})
