import campus from '../../cloudfunctions/market/campus.json'

/** Shared with the market cloud function so school identity has one source. */
export const campusConfig = campus

const obsoleteLocation = /(?:北区|[东西南北])校区/u

export function normalizeLegacyLocation(location?: string): string {
  const value = location?.trim()
  return value && !obsoleteLocation.test(value) ? value : campus.defaultTradeLocation
}
