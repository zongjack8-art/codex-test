import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import profileCampusBg from '../../assets/profile-campus-bg.jpg'
import AppButton from '../../components/AppButton'
import Avatar from '../../components/Avatar'
import { Badge } from '../../components/Badge'
import Icon, { type IconName } from '../../components/Icon'
import TabNav from '../../components/TabNav'
import { campusConfig } from '../../config/campus'
import { demoUser } from '../../data/mock'
import { useAdminNotifications } from '../../hooks/useAdminNotifications'
import { getCurrentUser, getSession, loginWithWechat, signOut } from '../../services/auth'
import { getDataMode, isH5CloudFallback } from '../../services/mode'
import { getOrderUnreadSummary } from '../../services/orders'
import { getFavoriteIds, getMyProducts } from '../../services/products'
import type { Session, UserProfile } from '../../types/market'
import { unreadCountLabel } from '../../utils/orders'

type ProfileMenuItem = { icon: IconName; label: string; subtitle: string; tone?: 'green' | 'blue' | 'peach'; action: () => void }

export default function ProfilePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile>(getDataMode() === 'cloud' ? { ...demoUser, avatar: '同' } : demoUser)
  const [profileLoading, setProfileLoading] = useState(getDataMode() === 'cloud')
  const [profileError, setProfileError] = useState(false)
  const [listingCount, setListingCount] = useState(0)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [soldCount, setSoldCount] = useState(0)
  const [orderUnread, setOrderUnread] = useState(0)
  const { isAdmin, pendingReports } = useAdminNotifications()
  const unreadRequest = useRef(0)

  const loadProfile = () => {
    setProfileLoading(getDataMode() === 'cloud')
    setProfileError(false)
    getCurrentUser().then(user => { setProfile(user); setSession(getSession()) }).catch(() => setProfileError(true)).finally(() => setProfileLoading(false))
  }

  useDidShow(() => {
    const request = ++unreadRequest.current
    getOrderUnreadSummary().then(summary => { if (request === unreadRequest.current) setOrderUnread(summary.total) }).catch(() => { if (request === unreadRequest.current) setOrderUnread(0) })
    setSession(getSession())
    loadProfile()
    getMyProducts().then(items => { setListingCount(items.length); setSoldCount(items.filter(item => item.status === 'sold').length) }).catch(() => undefined)
    getFavoriteIds().then(ids => setFavoriteCount(ids.length)).catch(() => undefined)
  })

  const login = async () => {
    try { const next = await loginWithWechat(); setSession(next); setProfile(next.user); Taro.showToast({ title: getDataMode() === 'mock' ? '已进入演示模式' : '登录成功', icon: 'none' }) }
    catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  }

  const tradeMenu: ProfileMenuItem[] = [
    { icon: 'package', label: '我的发布', subtitle: '管理我发布的二手商品', tone: 'green', action: () => Taro.navigateTo({ url: '/pages/my-listings/index' }) },
    { icon: 'check', label: '我的订单', subtitle: '查看购买与出售的订单', tone: 'blue', action: () => Taro.navigateTo({ url: '/pages/orders/index' }) },
    { icon: 'heart', label: '我的收藏', subtitle: '我收藏的好物', tone: 'peach', action: () => Taro.navigateTo({ url: '/pages/favorites/index' }) },
    { icon: 'clock', label: '最近浏览', subtitle: '查看我浏览过的商品', tone: 'blue', action: () => Taro.navigateTo({ url: '/pages/history/index' }) }
  ]

  const accountMenu: ProfileMenuItem[] = [
    { icon: 'edit', label: '编辑个人资料', subtitle: '完善个人信息，让更多同学认识你', tone: 'green', action: () => Taro.navigateTo({ url: '/pages/profile/edit' }) },
    { icon: 'shield', label: '我的举报', subtitle: '查看举报进度和平台处理结果', tone: 'peach', action: () => Taro.navigateTo({ url: '/pages/my-reports/index' }) },
    { icon: 'shield', label: '交易安全提醒', subtitle: '校园交易安全小贴士', tone: 'green', action: () => Taro.showModal({ title: '安心面交', content: '优先约在图书馆、食堂等校内公共区域；现场核对商品；不要提前转账。', showCancel: false }) },
    ...(isAdmin ? [{ icon: 'shield' as IconName, label: '管理后台', subtitle: '处理举报和平台管理事项', tone: 'blue' as const, action: () => Taro.navigateTo({ url: '/pages/admin/index' }) }] : []),
    { icon: 'spark', label: '关于校园集市', subtitle: '了解我们和平台规则', tone: 'blue', action: () => Taro.showModal({ title: `关于 ${campusConfig.brandName}`, content: getDataMode() === 'mock' ? `${campusConfig.schoolSlogan}。当前为本机演示版本，数据不会跨设备同步。` : `${campusConfig.schoolSlogan}。通过站内消息约好面交时间地点，验货后双方自行付款；平台不提供支付或担保。`, showCancel: false }) }
  ]

  const renderMenu = (items: ProfileMenuItem[]) => <View className='profile-menu-card'>{items.map(item => <View key={item.label} className='profile-menu-card__item' onClick={item.action}>
    <View className={`profile-menu-card__icon profile-menu-card__icon--${item.tone || 'green'}`}><Icon name={item.icon} size='md' /></View>
    <View className='profile-menu-card__copy'><Text className='profile-menu-card__title'>{item.label}</Text><Text className='profile-menu-card__subtitle'>{item.subtitle}</Text></View>
    {item.label === '我的订单' && orderUnread > 0 && <Badge tone='danger' className='menu-card__unread'>{unreadCountLabel(orderUnread)}</Badge>}
    {item.label === '管理后台' && isAdmin && pendingReports > 0 && <Badge tone='danger' className='menu-card__unread'>{unreadCountLabel(pendingReports)}</Badge>}
    <Icon name='chevron' size='sm' className='profile-menu-card__arrow' />
  </View>)}</View>

  return <View className='page page--with-nav profile-page'>
    <View className='profile-hero-v3'>
      <Image className='profile-hero-v3__image' src={profileCampusBg} mode='aspectFill' />
      <View className='profile-hero-v3__wash' />
      <Text className='profile-hero-v3__eyebrow'>MY CAMPUSMARKET</Text>
      <View className='profile-hero-v3__main'>
        <View className='profile-user-v3'>
          <Avatar className='profile-user-v3__avatar' value={profile.avatar} />
          <View className='profile-user-v3__info'>
            <Text className='profile-user-v3__name'>{profileLoading ? '正在连接…' : profileError ? '暂未连接' : profile.nickname || '你好，同学'}</Text>
            <Text className='profile-user-v3__sub'>{campusConfig.schoolName} · {profile.campus}</Text>
            <Badge tone='primary'>{getDataMode() === 'mock' ? '本机演示身份' : profileError ? '身份未连接' : profileLoading ? '连接中' : '微信用户'}</Badge>
          </View>
        </View>
        <View className='profile-hero-v3__quote'><Text>在校园</Text><Text>发现更多好物</Text><Text>让闲置继续发光 ✨</Text></View>
      </View>
    </View>

    <View className='content-pad profile-content-v3'>
      <View className='profile-stats-v3'>
        <View onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index' })}><Text className='profile-stats-v3__number'>{listingCount}</Text><View className='profile-stats-v3__label'><Icon name='package' size='sm' /><Text>我的发布</Text></View></View>
        <View onClick={() => Taro.navigateTo({ url: '/pages/favorites/index' })}><Text className='profile-stats-v3__number'>{favoriteCount}</Text><View className='profile-stats-v3__label'><Icon name='heart' size='sm' /><Text>我的收藏</Text></View></View>
        <View onClick={() => Taro.navigateTo({ url: '/pages/my-listings/index?status=sold' })}><Text className='profile-stats-v3__number'>{soldCount}</Text><View className='profile-stats-v3__label'><Icon name='package' size='sm' /><Text>已售出</Text></View></View>
      </View>

      {isH5CloudFallback() && <Text className='mode-banner'>H5 当前使用本机演示数据。</Text>}
      {profileError && <View className='profile-connect-error'><Text>云端身份暂时不可用，请检查环境和 market 云函数后重试。</Text><AppButton variant='secondary' onClick={loadProfile}>重新连接</AppButton></View>}

      <View className='profile-section-heading-v3'><Text>交易管理</Text><Text>发布、订单与收藏</Text></View>
      {renderMenu(tradeMenu)}

      <View className='profile-section-heading-v3 profile-section-heading-v3--secondary'><Text>账号与安全</Text><Text>资料、安全与平台信息</Text></View>
      {renderMenu(accountMenu)}

      <View className='profile-safety-banner' onClick={() => Taro.showModal({ title: '校园面交，放心一点', content: '见面验货、确认状态，再完成交易。优先选择校内公共区域。', showCancel: false })}>
        <View className='profile-safety-banner__icon'><Icon name='shield' size='md' /></View>
        <View><Text>校园面交，放心一点</Text><Text>见面验货、确认状态，再完成交易</Text></View>
        <Icon name='chevron' size='sm' className='profile-safety-banner__arrow' />
      </View>

      {getDataMode() !== 'cloud' && <AppButton variant='ghost' block onClick={session ? () => { signOut(); setSession(null); setProfile(demoUser); Taro.showToast({ title: '已退出演示身份', icon: 'none' }) } : login}>{session ? '退出当前身份' : (getDataMode() === 'api' ? '微信登录' : '进入演示身份')}</AppButton>}
    </View>
    <TabNav active='profile' orderUnreadCount={orderUnread} adminPendingReports={pendingReports} />
  </View>
}
