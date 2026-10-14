const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../src/services/mockChatCore.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleLike = { exports: {} }
new Function('module', 'exports', code)(moduleLike, moduleLike.exports)
const { startMockConversation, sendMockMessage, markMockConversationRead } = moduleLike.exports

test('Mock 会话复用、文字发送与已读状态可在本地演示', () => {
  const product = { id: 'p1', seller: { id: 'seller', nickname: '林同学', avatar: '林' }, title: '教材', price: 20, images: [], status: 'selling' }
  const empty = { conversations: [], messages: [] }
  const first = startMockConversation(empty, product, 'buyer', 1000)
  const again = startMockConversation(first.state, product, 'buyer', 2000)
  assert.equal(again.state.conversations.length, 1)
  assert.equal(again.conversation.id, first.conversation.id)
  const sent = sendMockMessage(again.state, first.conversation.id, 'buyer', '  请问还在吗？ ', 3000)
  assert.equal(sent.message.content, '请问还在吗？')
  assert.equal(sent.state.messages.length, 1)
  assert.equal(sent.state.conversations[0].lastMessage, '请问还在吗？')
  assert.equal(markMockConversationRead(sent.state, first.conversation.id, 'buyer').conversations[0].unreadCount, 0)
  assert.throws(() => startMockConversation(empty, { ...product, seller: { id: 'buyer' } }, 'buyer', 1000), /自己/)
  assert.throws(() => sendMockMessage(empty, 'missing', 'buyer', '你好', 3000), /无权/)
})
