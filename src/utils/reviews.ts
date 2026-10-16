export function ratingStars(rating: number): string {
  const whole = Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0
  return '★'.repeat(whole) + '☆'.repeat(5 - whole)
}
