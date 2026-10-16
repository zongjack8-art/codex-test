const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../../src')
const pollerSource = fs.readFileSync(path.join(root, 'utils/visiblePoller.ts'), 'utf8')
const pollerCode = ts.transpileModule(pollerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const pollerModule = { exports: {} }
new Function('module', 'exports', pollerCode)(pollerModule, pollerModule.exports)
const { createVisiblePoller } = pollerModule.exports
const settle = () => new Promise(resolve => setImmediate(resolve))

function mountTabNav(props, getSummary) {
  const states = [], refs = [], effects = [], cleanups = [], shows = [], hides = [], timers = new Map()
  let mounted = false, stateIndex = 0, refIndex = 0, nextTimer = 0
  const scheduler = {
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id },
    clearInterval(id) { timers.delete(id) }
  }
  const jsx = (type, props) => ({ type, props })
  const taro = { ENV_TYPE: { WEAPP: 'WEAPP' }, getEnv: () => 'H5', reLaunch() {} }
  const dependencies = {
    '@tarojs/components': { Text: 'Text', View: 'View' },
    '@tarojs/taro': { __esModule: true, default: taro, useDidShow(callback) { shows.push(callback) }, useDidHide(callback) { hides.push(callback) } },
    react: {
      useState(initial) {
        const index = stateIndex++
        if (!mounted) states[index] = initial
        return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
      },
      useRef(initial) { const index = refIndex++; return refs[index] || (refs[index] = { current: initial }) },
      useEffect(callback) { if (!mounted) effects.push(callback) }
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../hooks/useAdminNotifications': { useAdminNotifications: () => ({ pendingReports: 0 }) },
    '../services/chat': { getUnreadMessageCount: async () => 0 },
    '../services/orders': { getOrderUnreadSummary: getSummary },
    '../utils/orders': { unreadCountLabel: count => count > 99 ? '99+' : String(count) },
    '../utils/visiblePoller': { createVisiblePoller: (task, delay) => createVisiblePoller(task, delay, scheduler) },
    './Icon': { __esModule: true, default: () => null }
  }
  const source = fs.readFileSync(path.join(root, 'components/TabNav.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const moduleLike = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
    return dependencies[name]
  }, moduleLike, moduleLike.exports)
  const TabNav = moduleLike.exports.default
  const render = () => {
    stateIndex = 0; refIndex = 0
    return TabNav(props)
  }
  render(); mounted = true
  effects.forEach(effect => cleanups.push(effect()))
  const badge = () => {
    const profileTab = render().props.children[4]
    const children = profileTab.props.children[0].props.children
    return children.find(child => child?.props?.className === 'tab-nav__badge')?.props.children
  }
  return {
    badge, timers,
    show: () => shows.forEach(callback => callback()),
    hide: () => hides.forEach(callback => callback()),
    tick: () => [...timers.values()].forEach(timer => timer.callback()),
    unmount: () => cleanups.forEach(cleanup => cleanup?.())
  }
}

test('首页可见时订单未读立即读取并每 5 秒刷新；失败保留数字，隐藏停止，返回立即刷新', async () => {
  let total = 0, fail = false, calls = 0
  const page = mountTabNav({ active: 'index', unreadCount: 0, adminPendingReports: 0 }, async () => {
    calls++
    if (fail) throw new Error('network')
    return { buyer: 0, seller: total, total }
  })
  await settle()
  assert.equal(calls, 1)
  assert.equal(page.badge(), undefined)
  assert.equal([...page.timers.values()][0].delay, 5000)
  total = 2; page.tick(); await settle()
  assert.equal(page.badge(), '2')
  fail = true; page.tick(); await settle()
  assert.equal(page.badge(), '2')
  page.show(); page.show()
  assert.equal(page.timers.size, 1)
  page.hide()
  assert.equal(page.timers.size, 0)
  const previousCalls = calls
  page.tick(); await settle()
  assert.equal(calls, previousCalls)
  fail = false; total = 0; page.show(); await settle()
  assert.equal(page.badge(), undefined)
  assert.equal(calls, previousCalls + 1)
  page.unmount()
  assert.equal(page.timers.size, 0)
})

test('父组件明确传入订单未读数时不启动订单轮询', async () => {
  let calls = 0
  const page = mountTabNav({ active: 'profile', unreadCount: 0, orderUnreadCount: 7, adminPendingReports: 0 }, async () => {
    calls++
    return { buyer: 0, seller: 99, total: 99 }
  })
  page.show(); page.tick(); await settle()
  assert.equal(page.badge(), '7')
  assert.equal(page.timers.size, 0)
  assert.equal(calls, 0)
  page.hide(); page.unmount()
})
