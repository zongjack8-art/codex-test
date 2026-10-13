import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import AppButton from '../../components/AppButton'
import Avatar from '../../components/Avatar'
import FormSection from '../../components/FormSection'
import Icon from '../../components/Icon'
import { getCurrentUser, updateProfile } from '../../services/auth'
import { removeMockImage, uploadImage } from '../../services/upload'

export default function ProfileEditPage() {
  const [nickname, setNickname] = useState('')
  const [school, setSchool] = useState('')
  const [campus, setCampus] = useState('')
  const [avatar, setAvatar] = useState('同')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const originalAvatar = useRef('同')
  useDidShow(() => { setLoading(true); getCurrentUser().then(user => { setNickname(user.nickname); setSchool(user.school); setCampus(user.campus); setAvatar(user.avatar); originalAvatar.current = user.avatar }).catch(error => Taro.showToast({ title: error.message, icon: 'none' })).finally(() => setLoading(false)) })

  const chooseAvatar = async () => {
    try { const result = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] }); setAvatar(result.tempFilePaths[0]) }
    catch (error) { if (!String((error as Error).message).includes('cancel')) Taro.showToast({ title: '选择头像失败，请再试一次', icon: 'none' }) }
  }
  const save = async () => {
    if (saving || loading) return
    if (nickname.trim().length < 2 || !school.trim() || !campus.trim()) return Taro.showToast({ title: '请完善昵称、学校和校区', icon: 'none' })
    setSaving(true)
    let savedAvatar = avatar
    try {
      savedAvatar = avatar === originalAvatar.current ? avatar : await uploadImage(avatar, 'avatar')
      await updateProfile({ nickname: nickname.trim(), school: school.trim(), campus: campus.trim(), avatar: savedAvatar })
      if (originalAvatar.current !== savedAvatar) await removeMockImage(originalAvatar.current)
      Taro.showToast({ title: '资料已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 700)
    } catch (error) { if (savedAvatar !== avatar) await removeMockImage(savedAvatar); Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
    finally { setSaving(false) }
  }

  return <View className='page'><View className='page-heading'><Text className='page-heading__eyebrow'>YOUR PROFILE</Text><Text className='page-heading__title'>编辑个人资料</Text><Text className='page-heading__desc'>让同校同学更好地认识你。</Text></View><View className='content-pad profile-edit-content'>
    <View className='profile-edit-avatar' onClick={chooseAvatar}><Avatar value={avatar} className='profile-edit-avatar__image' /><View><Text>更换头像</Text><Text>用一张喜欢的照片展示自己</Text></View><Icon name='camera' size='md' /></View>
    <FormSection title='基本信息'><View className='form-field'><Text className='form-field__label'>昵称</Text><Input className='form-input' maxlength={32} value={nickname} onInput={event => setNickname(event.detail.value)} placeholder='输入你的昵称' /></View><View className='form-field'><Text className='form-field__label'>学校</Text><Input className='form-input' maxlength={60} value={school} onInput={event => setSchool(event.detail.value)} placeholder='输入学校名称' /></View><View className='form-field'><Text className='form-field__label'>校区</Text><Input className='form-input' maxlength={60} value={campus} onInput={event => setCampus(event.detail.value)} placeholder='输入所在校区' /></View></FormSection>
    <View className='profile-edit-tip'><Icon name='shield' size='sm' /><Text>建议只填写必要的公开信息，不要留下手机号或宿舍号。</Text></View>
    <AppButton block onClick={save} loading={saving} disabled={loading}>保存资料</AppButton>
  </View></View>
}
