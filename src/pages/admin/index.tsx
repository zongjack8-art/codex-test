import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import { getAdminStatus } from '../../services/admin'

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const load = () => {
    setAllowed(null)
    getAdminStatus().then(result => setAllowed(result.isAdmin === true)).catch(() => setAllowed(false))
  }
  useDidShow(load)

  return <View className='page'>
    <View className='page-heading'><Text className='page-heading__eyebrow'>CAMPUS CARE</Text><Text className='page-heading__title'>管理员后台</Text><Text className='page-heading__desc'>校园集市内容管理</Text></View>
    <View className='content-pad admin-content'>
      {allowed === null ? <View className='listing-skeleton'><View /></View> : !allowed ? <EmptyState kind='error' title='你没有管理员权限' description='管理入口仅对已授权的校园管理员开放' action='返回我的' onAction={() => Taro.reLaunch({ url: '/pages/profile/index' })} /> : <>
        <View className='admin-entry' onClick={() => Taro.navigateTo({ url: '/pages/admin/products/index' })}><View className='admin-entry__icon'><Icon name='package' size='md' /></View><View><Text className='admin-entry__title'>商品管理</Text><Text className='admin-entry__desc'>查看全部商品并处理违规商品</Text></View><Icon name='chevron' size='sm' /></View>
        <View className='admin-entry' onClick={() => Taro.navigateTo({ url: '/pages/admin/reports/index' })}><View className='admin-entry__icon'><Icon name='shield' size='md' /></View><View><Text className='admin-entry__title'>举报处理</Text><Text className='admin-entry__desc'>查看并处理商品举报</Text></View><Icon name='chevron' size='sm' /></View>
      </>}
    </View>
  </View>
}
