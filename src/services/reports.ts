import { campusConfig } from '../config/campus'
import { demoUser } from '../data/mock'
import { apiRequest } from './api'
import { ensureUserSession } from './auth'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { getProduct } from './products'
import { readLocal, writeLocal } from './storage'

export type ReportReason = 'prohibited' | 'misleading' | 'fraud' | 'other'
export interface ReportInput { productId: string; reason: ReportReason; description?: string }
export interface MyReport {
  id: string
  productId: string
  reason: ReportReason
  description: string
  createdAt: number
  status: 'pending' | 'resolved' | 'dismissed'
  resolution: 'takedown' | 'dismiss' | null
  resolvedAt: number | null
  productTitle: string
  productImage: string
}

const MOCK_REPORTS_KEY = 'campusmarket.reports.v1'
const REPORT_RESULTS_SEEN_AT_KEY = 'campusmarket.reportResultsSeenAt.v1'

export async function submitReport(report: ReportInput): Promise<{ created: boolean }> {
  if (getDataMode() === 'cloud') {
    await ensureUserSession()
    return cloudCall('createReport', { report })
  }
  if (getDataMode() === 'api') return apiRequest('/reports', 'POST', report)
  const product = await getProduct(report.productId)
  if (!product) throw new Error('商品不存在')
  if (product.seller.id === demoUser.id) throw new Error('不能举报自己的商品')
  const existing = readLocal<(ReportInput & { createdAt: string; school: string })[]>(MOCK_REPORTS_KEY, [])
  if (existing.some(item => item.productId === report.productId)) return { created: false }
  writeLocal(MOCK_REPORTS_KEY, [...existing, { ...report, school: campusConfig.schoolName, createdAt: new Date().toISOString() }])
  return { created: true }
}

export async function listMyReports(): Promise<MyReport[]> {
  if (getDataMode() === 'cloud') {
    await ensureUserSession()
    const result = await cloudCall<{ isAdmin: boolean; myReports?: MyReport[] }>('getAdminStatus', { includeMyReports: true })
    return result.myReports || []
  }
  return []
}

export function getUnreadReportResultCount(items: MyReport[]): number {
  const seenAt = readLocal<number>(REPORT_RESULTS_SEEN_AT_KEY, 0)
  return items.filter(item => item.resolvedAt && item.resolvedAt > seenAt).length
}

export function markReportResultsRead(items: MyReport[]): void {
  const latestResolvedAt = items.reduce((latest, item) => Math.max(latest, item.resolvedAt || 0), 0)
  if (latestResolvedAt > 0) writeLocal(REPORT_RESULTS_SEEN_AT_KEY, latestResolvedAt)
}
