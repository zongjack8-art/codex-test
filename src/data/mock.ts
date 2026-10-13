import p1 from '../assets/products/p1.jpg'
import p2 from '../assets/products/p2.jpg'
import p3 from '../assets/products/p3.jpg'
import p4 from '../assets/products/p4.jpg'
import p5 from '../assets/products/p5.jpg'
import p6 from '../assets/products/p6.jpg'
import p7 from '../assets/products/p7.jpg'
import p8 from '../assets/products/p8.jpg'
import type { CategoryId, Product, Seller, UserProfile } from '../types/market'

export const categories: { id: CategoryId; name: string; shortName: string; icon: 'book' | 'laptop' | 'bed' | 'bike' | 'shirt' | 'more' }[] = [
  { id: 'books', name: '教材资料', shortName: '教材', icon: 'book' },
  { id: 'digital', name: '数码电子', shortName: '数码', icon: 'laptop' },
  { id: 'daily', name: '宿舍生活', shortName: '宿舍', icon: 'bed' },
  { id: 'sports', name: '运动出行', shortName: '运动', icon: 'bike' },
  { id: 'fashion', name: '服饰穿搭', shortName: '穿搭', icon: 'shirt' },
  { id: 'other', name: '其他好物', shortName: '更多', icon: 'more' }
]

export const demoUser: UserProfile = {
  id: 'demo-me', nickname: '小沐', school: '青禾大学', campus: '北校区', avatar: '沐'
}

const seller = (id: string, nickname: string, campus: string, avatar: string): Seller => ({ id, nickname, campus, avatar })

export const mockProducts: Product[] = [
  { id: 'p1', title: 'iPad Pro 2020 12.9 英寸，附键盘保护套', description: '自用 iPad Pro，屏幕和触控都正常，边框有轻微使用痕迹。附键盘保护套和充电器，北校区图书馆可当面验机。', price: 2599, originalPrice: 7199, category: 'digital', condition: '九成新', campus: '北校区', images: [p1], coverEmoji: '📱', coverColor: '#e5ede9', seller: seller('u1', '林同学', '北校区', '林'), createdAt: '2026-10-13T08:30:00+08:00', status: 'selling' },
  { id: 'p2', title: '设计专业参考书与课堂笔记 3 本', description: '上学期课程用书，书角有正常翻阅痕迹，重点章节做了便签。打包出，南校区教学楼附近可面交。', price: 55, originalPrice: 168, category: 'books', condition: '八成新', campus: '南校区', images: [p2], coverEmoji: '📚', coverColor: '#f4eee1', seller: seller('u2', '小橙', '南校区', '橙'), createdAt: '2026-10-12T17:10:00+08:00', status: 'selling' },
  { id: 'p3', title: '宿舍可调节黑色台灯', description: '毕业搬宿舍清闲置。灯光正常，底座有一点使用痕迹，适合放在书桌上。北校区宿舍楼下自提。', price: 28, originalPrice: 89, category: 'daily', condition: '八成新', campus: '北校区', images: [p3], coverEmoji: '💡', coverColor: '#eee8df', seller: seller('u3', '阿北', '北校区', '北'), createdAt: '2026-10-12T12:20:00+08:00', status: 'selling' },
  { id: 'p4', title: '红黑配色羽毛球拍，送拍套', description: '球拍闲置转让，拍框没有磕碰，拍线状态良好。东校区体育馆门口可以试拍。', price: 128, originalPrice: 299, category: 'sports', condition: '九成新', campus: '东校区', images: [p4], coverEmoji: '🏸', coverColor: '#e9f0e8', seller: seller('u4', '山风', '东校区', '山'), createdAt: '2026-10-11T19:40:00+08:00', status: 'selling' },
  { id: 'p5', title: 'Sony WH-CH510 蓝牙头戴耳机', description: '蓝牙连接和充电正常，耳罩已擦拭。平时自习用，附原装充电线，可在南校区食堂附近试听。', price: 95, originalPrice: 299, category: 'digital', condition: '八成新', campus: '南校区', images: [p5], coverEmoji: '🎧', coverColor: '#e7e9ed', seller: seller('u5', '知知', '南校区', '知'), createdAt: '2026-10-11T09:05:00+08:00', status: 'selling' },
  { id: 'p6', title: '浅蓝色牛仔外套 M 码', description: '穿过几次，已清洗。版型宽松，适合春秋穿。西校区可当面看衣服。', price: 68, originalPrice: 229, category: 'fashion', condition: '九成新', campus: '西校区', images: [p6], coverEmoji: '🧥', coverColor: '#e8edf2', seller: seller('u6', '芝麻', '西校区', '芝'), createdAt: '2026-10-10T15:30:00+08:00', status: 'selling' },
  { id: 'p7', title: '宿舍挂耳咖啡冲泡套装', description: '滤杯和分享杯一起出，附几包挂耳咖啡。适合早八前在宿舍冲一杯，北校区面交。', price: 42, originalPrice: 118, category: 'daily', condition: '九成新', campus: '北校区', images: [p7], coverEmoji: '☕', coverColor: '#f1e9dc', seller: seller('u7', '可可', '北校区', '可'), createdAt: '2026-10-09T08:10:00+08:00', status: 'selling' },
  { id: 'p8', title: '富士 Instax SQ6 拍立得相机', description: '毕业季活动用过，成像和闪光灯都正常，附相机带和两盒相纸。东校区图书馆面交。', price: 360, originalPrice: 899, category: 'digital', condition: '八成新', campus: '东校区', images: [p8], coverEmoji: '📷', coverColor: '#f2e8e4', seller: seller('u8', '阿晴', '东校区', '晴'), createdAt: '2026-10-08T17:20:00+08:00', status: 'selling' }
]
