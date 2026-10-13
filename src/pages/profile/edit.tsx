import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import Avatar from '../../components/Avatar'
import { getCurrentUser, updateProfile } from '../../services/auth'
import { uploadImage } from '../../services/upload'

export default function ProfileEditPage() {
  const [nickname, setNickname] = useState('')
  const [school, setSchool] = useState('')
  const [campus, setCampus] = useState('')
  const [avatar, setAvatar] = useState('🎓')
  const [saving, setSaving] = useState(false)
  useDidShow(() => { getCurrentUser().then(user => { setNickname(user.nickname); setSchool(user.school); setCampus(user.campus); setAvatar(user.avatar) }).catch(error => Taro.showToast({ title: error.message, icon: 'none' })) })

  const chooseAvatar = async () => {
    try { const result = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] }); setAvatar(result.tempFilePaths[0]) }
    catch (error) { if (!String((error as Error).message).includes('cancel')) Taro.showToast({ title: '选择头像失败', icon: 'none' }) }
  }
  const save = async () => {
    if (saving) return
    if (nickname.trim().length < 2 || !school.trim() || !campus.trim()) return Taro.showToast({ title: '请完善昵称、学校和校区', icon: 'none' })
    setSaving(true)
    try {
      const image = avatar === '🎓' || /^(cloud|https?):\/\//.test(avatar) ? avatar : await uploadImage(avatar, 'avatar')
      await updateProfile({ nickname: nickname.trim(), school: school.trim(), campus: campus.trim(), avatar: image })
      Taro.showToast({ title: '资料已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 700)
    } catch (error) { Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setSaving(false) }
  }

  return <View className='page'><View className='page-heading'><Text className='eyebrow'>YOUR PROFILE</Text><Text className='page-heading__title'>个人资料</Text><Text className='page-heading__desc'>让同校同学更好地认识你。</Text></View><View className='content-pad publish-form'>
    <View className='form-card profile-edit-avatar' onClick={chooseAvatar}><Avatar value={avatar} className='profile-user__avatar' /><Text>点击更换头像</Text></View>
    <View className='form-card'><Text className='form-label'>昵称</Text><Input className='form-input' maxlength={32} value={nickname} onInput={event => setNickname(event.detail.value)} placeholder='请输入昵称' /></View>
    <View className='form-card'><Text className='form-label'>学校</Text><Input className='form-input' maxlength={60} value={school} onInput={event => setSchool(event.detail.value)} placeholder='请输入学校名称' /></View>
    <View className='form-card'><Text className='form-label'>校区</Text><Input className='form-input' maxlength={60} value={campus} onInput={event => setCampus(event.detail.value)} placeholder='请输入校区' /></View>
    <View className='button-primary button-primary--wide' onClick={save}>{saving ? '保存中...' : '保存资料'}</View>
  </View></View>
}
