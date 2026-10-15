import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../../components/AppButton'
import { Badge, StatusBadge } from '../../../components/Badge'
import EmptyState from '../../../components/EmptyState'
import ProductPhoto from '../../../components/ProductPhoto'
import { campusConfig } from '../../../config/campus'
import { adminListProducts, adminTakeDownProduct, getAdminStatus, type AdminProduct } from '../../../services/admin'
import { formatDetailTime } from '../../../utils/format'

const reason = '违反平台商品发布规范'

export default function AdminProductsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [items, setItems] = useState<AdminProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [pendingId, setPendingId] = useState('')
  const busy = useRef(false)

  const load = async () => {
    setLoading(true); setError(false)
    try { setItems(await adminListProducts()) }
    catch { setError(true) }
    finally { setLoading(false) }
  }
  useDidShow(() => {
    setAllowed(null)
    getAdminStatus().then(result => {
      setAllowed(result.isAdmin === true)
      if (result.isAdmin) void load()
    }).catch(() => setAllowed(false))
  })
  const takeDown = async (item: AdminProduct) => {
    if (busy.current) return
    busy.current = true
    setPendingId(item.id)
    try {
      const result = await Taro.showModal({ title: '下架商品', content: `确定下架「${item.title}」吗？理由：${reason}` })
      if (!result.confirm) return
      await adminTakeDownProduct(item.id, reason)
      Taro.showToast({ title: '商品已下架', icon: 'none' })
      await load()
    } catch (failure) { Taro.showToast({ title: (failure as Error).message || '操作失败，请重试', icon: 'none' }) }
    finally { busy.current = false; setPendingId('') }
  }

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CONTENT CARE</Text><Text className='page-heading__title'>商品管理</Text><Text className='page-heading__desc'>守护{campusConfig.schoolName}校园好物环境</Text></View>
    <View className='content-pad admin-content'>
      {allowed === null ? <View className='listing-skeleton'><View /></View> : !allowed ? <EmptyState kind='error' title='你没有管理员权限' action='返回我的' onAction={() => Taro.reLaunch({ url: '/pages/profile/index' })} /> : loading ? <View className='listing-skeleton'><View /><View /></View> : error ? <EmptyState kind='error' title='商品暂时没加载出来' description='请检查网络后重试' action='重试' onAction={load} /> : items.length ? items.map(item => <View key={item.id} className='admin-card'>
        <View className='admin-card__main'><ProductPhoto src={item.image} className='admin-card__photo' /><View className='admin-card__body'><Text className='admin-card__title'>{item.title}</Text><View className='admin-card__badges'><StatusBadge status={item.status} />{item.moderationStatus === 'blocked' && <Badge tone='danger'>管理员已下架</Badge>}</View><Text className='admin-card__meta'>卖家：{item.sellerNickname} · {formatDetailTime(item.createdAt)}</Text><Text className='admin-card__price'>¥{item.price}</Text></View></View>
        {item.status === 'selling' && item.moderationStatus !== 'blocked' && <View className='admin-card__actions'><AppButton variant='danger' loading={pendingId === item.id} onClick={() => takeDown(item)}>下架商品</AppButton></View>}
      </View>) : <EmptyState kind='listings' title='暂时没有商品' description='新发布的校园好物会出现在这里' />}
    </View>
  </View>
}
