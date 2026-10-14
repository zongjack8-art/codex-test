const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../src/utils/format.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleLike = { exports: {} }
new Function('module', 'exports', code)(moduleLike, moduleLike.exports)
const { formatDetailTime } = moduleLike.exports

test('详情发布时间按用户可读时间展示，旧数据缺少时间时安全回退', () => {
  const now = Date.UTC(2026, 9, 14, 12, 0)
  assert.equal(formatDetailTime(now - 20_000, now), '刚刚')
  assert.equal(formatDetailTime(now - 5 * 60_000, now), '5分钟前')
  assert.equal(formatDetailTime(now - 2 * 3_600_000, now), '2小时前')
  assert.equal(formatDetailTime(now - 25 * 3_600_000, now), '昨天')
  assert.equal(formatDetailTime(now - 3 * 86_400_000, now), '3天前')
  assert.equal(formatDetailTime('2026-10-01T12:00:00Z', now), '2026-10-01')
  assert.equal(formatDetailTime('', now), '发布时间待补充')
})
