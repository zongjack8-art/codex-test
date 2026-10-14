import { campusConfig } from '../config/campus'
import { apiRequest } from './api'
import { cloudCall } from './cloudbase'
import { getDataMode } from './mode'
import { readLocal, writeLocal } from './storage'

export type ReportReason = 'prohibited' | 'misleading' | 'fraud' | 'other'
export interface ReportInput { productId: string; reason: ReportReason; description?: string }

const MOCK_REPORTS_KEY = 'campusmarket.reports.v1'

/** Reserved for a future lightweight report entry; no report UI is shown yet. */
export async function submitReport(report: ReportInput): Promise<{ created: boolean }> {
  if (getDataMode() === 'cloud') return cloudCall('createReport', { report })
  if (getDataMode() === 'api') return apiRequest('/reports', 'POST', report)
  const existing = readLocal<(ReportInput & { createdAt: string; school: string })[]>(MOCK_REPORTS_KEY, [])
  if (existing.some(item => item.productId === report.productId)) return { created: false }
  writeLocal(MOCK_REPORTS_KEY, [...existing, { ...report, school: campusConfig.schoolName, createdAt: new Date().toISOString() }])
  return { created: true }
}
