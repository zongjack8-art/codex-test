import type { CategoryId, Product, Seller, UserProfile } from '../types/market'

export const categories: { id: CategoryId; name: string; emoji: string }[] = [
  { id: 'books', name: '书籍资料', emoji: '📚' },
  { id: 'digital', name: '数码电子', emoji: '💻' },
  { id: 'daily', name: '生活用品', emoji: '🛋️' },
  { id: 'sports', name: '运动户外', emoji: '🏸' },
  { id: 'fashion', name: '服饰美妆', emoji: '🧥' },
  { id: 'other', name: '其他好物', emoji: '🎁' }
]

export const demoUser: UserProfile = {
  id: 'demo-me', nickname: '校园同学', school: '示例大学', campus: '北区校区', avatar: '🎓'
}

const seller = (id: string, nickname: string, campus: string, avatar: string): Seller => ({ id, nickname, campus, avatar })

export const mockProducts: Product[] = [
  { id: 'p1', title: '九成新 iPad Air 5 64G', description: '自用一年，屏幕完好，送保护套和电容笔。可在图书馆当面验机。', price: 2450, originalPrice: 4399, category: 'digital', condition: '九成新', campus: '北区校区', images: [], coverEmoji: '📱', coverColor: '#e5ede9', seller: seller('u1', '林同学', '北区校区', '🌿'), createdAt: '2026-10-12T09:00:00Z', status: 'selling' },
  { id: 'p2', title: '考研英语真题全套', description: '2027 备考资料，笔记少，附送单词本。', price: 48, originalPrice: 138, category: 'books', condition: '九成新', campus: '南区校区', images: [], coverEmoji: '📚', coverColor: '#f4eee1', seller: seller('u2', '小橙', '南区校区', '🍊'), createdAt: '2026-10-11T15:30:00Z', status: 'selling' },
  { id: 'p3', title: '宿舍折叠小桌板', description: '毕业闲置，桌面干净稳固，寝室楼下自提。', price: 35, originalPrice: 99, category: 'daily', condition: '八成新', campus: '北区校区', images: [], coverEmoji: '🪑', coverColor: '#eee8df', seller: seller('u3', '阿北', '北区校区', '🐱'), createdAt: '2026-10-11T10:00:00Z', status: 'selling' },
  { id: 'p4', title: '尤尼克斯羽毛球拍', description: '拍线刚换，手感很好，送拍套。', price: 169, originalPrice: 399, category: 'sports', condition: '八成新', campus: '东区校区', images: [], coverEmoji: '🏸', coverColor: '#e9f0e8', seller: seller('u4', '山风', '东区校区', '🏔️'), createdAt: '2026-10-10T14:00:00Z', status: 'selling' },
  { id: 'p5', title: '索尼 WH-1000XM4 耳机', description: '降噪功能正常，带原装收纳盒和充电线。', price: 780, originalPrice: 1999, category: 'digital', condition: '八成新', campus: '南区校区', images: [], coverEmoji: '🎧', coverColor: '#e7e9ed', seller: seller('u5', '知知', '南区校区', '☁️'), createdAt: '2026-10-09T08:00:00Z', status: 'selling' },
  { id: 'p6', title: '秋季宽松牛仔外套', description: 'M 码，穿过两次，已清洗。', price: 65, originalPrice: 229, category: 'fashion', condition: '九成新', campus: '西区校区', images: [], coverEmoji: '🧥', coverColor: '#e8edf2', seller: seller('u6', '芝麻', '西区校区', '🌻'), createdAt: '2026-10-08T19:00:00Z', status: 'selling' },
  { id: 'p7', title: '手冲咖啡入门套装', description: '滤杯、分享壶、滤纸一起出，适合宿舍使用。', price: 88, originalPrice: 260, category: 'daily', condition: '九成新', campus: '北区校区', images: [], coverEmoji: '☕', coverColor: '#f1e9dc', seller: seller('u7', '可可', '北区校区', '🧸'), createdAt: '2026-10-08T07:00:00Z', status: 'selling' },
  { id: 'p8', title: '毕业季拍立得相机', description: '功能正常，附两盒相纸。', price: 320, originalPrice: 699, category: 'digital', condition: '八成新', campus: '东区校区', images: [], coverEmoji: '📷', coverColor: '#f2e8e4', seller: seller('u8', '阿晴', '东区校区', '🌷'), createdAt: '2026-10-07T12:00:00Z', status: 'selling' }
]
