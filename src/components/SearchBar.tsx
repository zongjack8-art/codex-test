import { Input, Text, View } from '@tarojs/components'
import Icon from './Icon'

type SearchBarProps = { placeholder?: string; value?: string; onInput?: (value: string) => void; onClick?: () => void; className?: string }

export default function SearchBar({ placeholder = '搜索教材、数码、自行车…', value = '', onInput, onClick, className = '' }: SearchBarProps) {
  return <View className={`search-bar ${className}`} onClick={onClick}>
    <Icon name='search' size='sm' />
    {onInput ? <Input className='search-bar__input' value={value} onInput={event => onInput(event.detail.value)} confirmType='search' placeholder={placeholder} /> : <Text className='search-bar__placeholder'>{placeholder}</Text>}
    {onInput && value ? <Text className='search-bar__clear' onClick={event => { event.stopPropagation(); onInput('') }}>×</Text> : <View className='search-bar__arrow'><Icon name='arrow' size='sm' /></View>}
  </View>
}
