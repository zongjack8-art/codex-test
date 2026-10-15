const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTS(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
    return dependencies[name]
  }, moduleLike, moduleLike.exports)
  return moduleLike.exports
}

const { createVisiblePoller } = loadTS('utils/visiblePoller.ts')
const settle = () => new Promise(resolve => setImmediate(resolve))

function mount(service, enabled = true) {
  const states = [], refs = [], effects = [], cleanups = [], timers = new Map()
  let stateIndex = 0, refIndex = 0, nextTimer = 0, mounted = false, show, hide
  const scheduler = {
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id },
    clearInterval(id) { timers.delete(id) }
  }
  const { useAdminNotifications } = loadTS('hooks/useAdminNotifications.ts', {
    '@tarojs/taro': { useDidShow(callback) { show = callback }, useDidHide(callback) { hide = callback } },
    react: {
      useState(initial) {
        const index = stateIndex++
        if (!mounted) states[index] = initial
        return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
      },
      useRef(initial) { const index = refIndex++; return refs[index] || (refs[index] = { current: initial }) },
      useEffect(callback) { if (!mounted) effects.push(callback) }
    },
    '../services/admin': service,
    '../utils/visiblePoller': { createVisiblePoller: (task, delay) => createVisiblePoller(task, delay, scheduler) }
  })
  const view = () => { stateIndex = 0; refIndex = 0; return useAdminNotifications(enabled) }
  view(); mounted = true
  effects.forEach(effect => cleanups.push(effect()))
  return {
    view, timers, show: () => show(), hide: () => hide(),
    tick: () => { for (const timer of timers.values()) timer.callback() },
    unmount: () => cleanups.forEach(cleanup => cleanup?.())
  }
}

test('管理员提醒立即刷新、每 5 秒静默更新；失败保留数字，返回刷新，隐藏卸载清理', async () => {
  let count = 2, fail = false, admin = true, calls = 0
  const page = mount({
    getAdminStatus: async () => ({ isAdmin: admin }),
    getAdminNotificationSummary: async () => { calls++; if (fail) throw new Error('network'); return { pendingReports: count } }
  })
  await settle()
  assert.deepEqual(page.view(), { isAdmin: true, pendingReports: 2 })
  assert.equal([...page.timers.values()][0].delay, 5000)
  page.show(); page.show()
  assert.equal(page.timers.size, 1)
  fail = true; page.tick(); await settle()
  assert.equal(page.view().pendingReports, 2)
  fail = false; count = 1; page.tick(); await settle()
  assert.equal(page.view().pendingReports, 1)
  page.hide()
  assert.equal(page.timers.size, 0)
  const previousCalls = calls
  page.tick(); await settle()
  assert.equal(calls, previousCalls)
  count = 0; page.show(); await settle()
  assert.equal(page.view().pendingReports, 0)
  admin = false; page.tick(); await settle()
  assert.deepEqual(page.view(), { isAdmin: false, pendingReports: 0 })
  page.unmount()
  assert.equal(page.timers.size, 0)
})

test('普通用户不查询管理员计数；父组件提供数量时不重复轮询', async () => {
  let countCalls = 0
  const service = {
    getAdminStatus: async () => ({ isAdmin: false }),
    getAdminNotificationSummary: async () => { countCalls++; return { pendingReports: 42 } }
  }
  const page = mount(service)
  await settle()
  assert.deepEqual(page.view(), { isAdmin: false, pendingReports: 0 })
  assert.equal(countCalls, 0)
  page.unmount()
  const disabled = mount(service, false)
  disabled.show(); await settle()
  assert.equal(disabled.timers.size, 0)
  assert.equal(countCalls, 0)
  disabled.unmount()
})
