import { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAdminNotificationSummary, getAdminStatus } from '../services/admin'
import { createVisiblePoller } from '../utils/visiblePoller'

export function useAdminNotifications(enabled = true) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [pendingReports, setPendingReports] = useState(0)
  const visible = useRef(true)
  const poller = useRef<ReturnType<typeof createVisiblePoller> | null>(null)
  if (!poller.current) poller.current = createVisiblePoller(async isCurrent => {
    try {
      const status = await getAdminStatus()
      if (!isCurrent()) return
      setIsAdmin(status.isAdmin === true)
      if (status.isAdmin !== true) { setPendingReports(0); return }
      const summary = await getAdminNotificationSummary()
      if (isCurrent()) setPendingReports(summary.pendingReports)
    } catch {
      // Preserve successful counts on network failure; show no admin UI before verification.
      if (isCurrent()) setIsAdmin(previous => previous ?? false)
    }
  }, 5000)
  useDidShow(() => { visible.current = true; if (enabled) poller.current?.start() })
  useDidHide(() => { visible.current = false; poller.current?.stop() })
  useEffect(() => {
    if (enabled && visible.current) poller.current?.start()
    else poller.current?.stop()
    return () => poller.current?.stop()
  }, [enabled])
  return { isAdmin, pendingReports: enabled && isAdmin === true ? pendingReports : 0 }
}
