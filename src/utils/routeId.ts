/** Keep the first valid ID for this page instance when Taro omits params on resume. */
export function retainRouteId(ref: { current: string }, candidate: unknown): string {
  if (!ref.current && typeof candidate === 'string' && candidate.trim()) ref.current = candidate
  return ref.current
}
