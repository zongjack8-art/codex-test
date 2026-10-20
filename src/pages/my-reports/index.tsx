import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Badge } from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import ProductPhoto from '../../components/ProductPhoto'
import { listMyReports, type MyReport, type ReportReason } from '../../services/reports'
import { formatDetailTime } from '../../utils/format'

const reasonLabels: Record<ReportReason, string> = {
  prohibited: '违禁/不适合交易',
  misleading: '描述不实',
  fraud: '疑似欺诈',
  other: '其他'
}

function statusCopy(item: MyReport) {
  if (item.status === 'resolved' || item.resolution === 'takedown') return { label: '已处理', tone: 'success' as const, result: '处理结果：相关商品已下架' }
  if (item.status === 'dismissed' || item.resolution === 'dismiss') return { label: '已驳回', tone: 'neutral' as const, result: '处理结果：经核查暂不下架该商品' }
  return { label: '处理中', tone: 'warning' as const, result: '处理结果：管理员正在核查' }
}

export default function MyReportsPage() {
  const [items, setItems] = useState<MyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(false)
    try { setItems(await listMyReports()) }
    catch { setError(true) }
    finally { setLoading(false) }
  }

  useDidShow(() => { void load() })

  return <View className='page'>
    <View className='page-heading'>
      <Text className='page-heading__eyebrow'>REPORT CENTER</Text>
      <Text className='page-heading__title'>我的举报</Text>
      <Text className='page-heading__desc'>查看举报进度和平台处理结果</Text>
    </View>
    <View className='content-pad admin-content'>
      {loading ? <View className='listing-skeleton'><View /><View /></View> : error ? <EmptyState kind='error' title='举报记录暂时没加载出来' description='请检查网络后重试' action='重试' onAction={load} /> : items.length ? items.map(item => {
        const state = statusCopy(item)
        return <View key={item.id} className='admin-card'>
          <View className='admin-card__main'>
            <ProductPhoto src={item.productImage} className='admin-card__photo' />
            <View className='admin-card__body'>
              <Text className='admin-card__title'>{item.productTitle}</Text>
              <View className='admin-card__badges'><Badge tone={state.tone}>{state.label}</Badge></View>
              <Text className='admin-card__meta'>举报原因：{reasonLabels[item.reason] || '其他'}</Text>
              <Text className='admin-card__meta'>提交时间：{formatDetailTime(item.createdAt)}</Text>
            </View>
          </View>
          {item.description && <Text className='admin-card__description'>{item.description}</Text>}
          <Text className='admin-card__description'>{state.result}</Text>
          {item.resolvedAt ? <Text className='admin-card__meta'>处理时间：{formatDetailTime(item.resolvedAt)}</Text> : null}
        </View>
      }) : <EmptyState kind='listings' title='还没有举报记录' description='你提交的商品举报会在这里显示处理结果' action='返回首页' onAction={() => Taro.reLaunch({ url: '/pages/index/index' })} />}
    </View>
  </View>
}
