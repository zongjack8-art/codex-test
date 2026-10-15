import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../../components/AppButton'
import { Badge } from '../../../components/Badge'
import EmptyState from '../../../components/EmptyState'
import ProductPhoto from '../../../components/ProductPhoto'
import { adminListReports, adminResolveReport, getAdminStatus, type AdminReport } from '../../../services/admin'
import { formatDetailTime } from '../../../utils/format'
import './index.scss'

const reasonLabels: Record<AdminReport['reason'], string> = { prohibited: '违禁/不适合交易', misleading: '描述不实', fraud: '疑似欺诈', other: '其他' }

export default function AdminReportsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [items, setItems] = useState<AdminReport[]>([])
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [pendingId, setPendingId] = useState('')
  const busy = useRef(false)

  const load = async () => {
    setLoading(true); setError(false)
    try { setItems(await adminListReports()) }
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
  const resolve = async (item: AdminReport, resolution: 'takedown' | 'dismiss') => {
    if (busy.current) return
    busy.current = true
    setPendingId(item.id)
    try {
      const result = await Taro.showModal({ title: resolution === 'takedown' ? '确认违规' : '驳回举报', content: resolution === 'takedown' ? '确认该商品违规并下架吗？' : '确认驳回这条举报吗？' })
      if (!result.confirm) return
      await adminResolveReport(item.id, resolution)
      Taro.showToast({ title: resolution === 'takedown' ? '商品已下架' : '举报已驳回', icon: 'none' })
      await load()
    } catch (failure) { Taro.showToast({ title: (failure as Error).message || '处理失败，请重试', icon: 'none' }) }
    finally { busy.current = false; setPendingId('') }
  }
  const visible = items.filter(item => tab === 'pending' ? item.status === 'pending' : item.status !== 'pending')

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>REPORT CARE</Text><Text className='page-heading__title'>举报处理</Text><Text className='page-heading__desc'>认真核对每一条关于商品的反馈</Text></View>
    <View className='content-pad admin-content'>
      {allowed === null ? <View className='listing-skeleton'><View /></View> : !allowed ? <EmptyState kind='error' title='你没有管理员权限' action='返回我的' onAction={() => Taro.reLaunch({ url: '/pages/profile/index' })} /> : <>
        <View className='listing-filters'><Text className={`listing-filter ${tab === 'pending' ? 'is-selected' : ''}`} onClick={() => setTab('pending')}>待处理</Text><Text className={`listing-filter ${tab === 'done' ? 'is-selected' : ''}`} onClick={() => setTab('done')}>已处理</Text></View>
        {loading ? <View className='listing-skeleton'><View /><View /></View> : error ? <EmptyState kind='error' title='举报暂时没加载出来' description='请检查网络后重试' action='重试' onAction={load} /> : visible.length ? visible.map(item => <View key={item.id} className='admin-card'>
          <View className='admin-card__main'><ProductPhoto src={item.productImage} className='admin-card__photo' /><View className='admin-card__body'><Text className='admin-card__title'>{item.productTitle}</Text><View className='admin-card__badges'><Badge tone={item.status === 'pending' ? 'warning' : item.status === 'resolved' ? 'success' : 'neutral'}>{item.status === 'pending' ? '待处理' : item.status === 'resolved' ? '已下架' : '已驳回'}</Badge></View><Text className='admin-card__meta'>{reasonLabels[item.reason] || '其他'} · {formatDetailTime(item.createdAt)}</Text><Text className='admin-card__meta'>卖家：{item.sellerNickname}</Text></View></View>
          {item.description && <Text className='admin-card__description'>{item.description}</Text>}
          {item.status === 'pending' && <View className='admin-card__actions'><AppButton variant='secondary' loading={pendingId === item.id} onClick={() => resolve(item, 'dismiss')}>驳回举报</AppButton><AppButton variant='danger' loading={pendingId === item.id} onClick={() => resolve(item, 'takedown')}>确认违规并下架</AppButton></View>}
        </View>) : <EmptyState kind='listings' title={tab === 'pending' ? '没有待处理举报' : '还没有处理记录'} description='校园集市的每一条反馈都会被认真对待' />}
      </>}
    </View>
  </View>
}
