import { Image } from '@tarojs/components'
import home from '../assets/icons/home.svg'
import grid from '../assets/icons/grid.svg'
import plus from '../assets/icons/plus.svg'
import heart from '../assets/icons/heart.svg'
import user from '../assets/icons/user.svg'
import search from '../assets/icons/search.svg'
import pin from '../assets/icons/pin.svg'
import shield from '../assets/icons/shield.svg'
import book from '../assets/icons/book.svg'
import laptop from '../assets/icons/laptop.svg'
import bed from '../assets/icons/bed.svg'
import bike from '../assets/icons/bike.svg'
import shirt from '../assets/icons/shirt.svg'
import racket from '../assets/icons/racket.svg'
import camera from '../assets/icons/camera.svg'
import arrow from '../assets/icons/arrow.svg'
import edit from '../assets/icons/edit.svg'
import trash from '../assets/icons/trash.svg'
import box from '../assets/icons/package.svg'
import check from '../assets/icons/check.svg'
import clock from '../assets/icons/clock.svg'
import spark from '../assets/icons/spark.svg'
import more from '../assets/icons/more.svg'
import chevron from '../assets/icons/chevron.svg'
import sliders from '../assets/icons/sliders.svg'

const sources = { home, grid, plus, heart, user, search, pin, shield, book, laptop, bed, bike, shirt, racket, camera, arrow, edit, trash, package: box, check, clock, spark, more, chevron, sliders }
export type IconName = keyof typeof sources

export default function Icon({ name, size = 'md', className = '' }: { name: IconName; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <Image className={`ui-icon ui-icon--${size} ${className}`} src={sources[name]} mode='aspectFit' />
}
