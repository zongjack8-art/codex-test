type IntervalHandle = ReturnType<typeof setInterval>

type Scheduler = {
  setInterval: (callback: () => void, delay: number) => IntervalHandle
  clearInterval: (handle: IntervalHandle) => void
}

const defaultScheduler: Scheduler = { setInterval, clearInterval }

/** Poll only while the owning page is visible; ignore results from an earlier visibility cycle. */
export function createVisiblePoller(
  task: (isCurrent: () => boolean, silent: boolean) => Promise<void>,
  intervalMs = 5000,
  scheduler: Scheduler = defaultScheduler
) {
  let timer: IntervalHandle | null = null
  let generation = 0
  let inFlightGeneration: number | null = null

  async function refresh(silent = true) {
    const currentGeneration = generation
    if (timer === null || inFlightGeneration === currentGeneration) return
    inFlightGeneration = currentGeneration
    try { await task(() => timer !== null && generation === currentGeneration, silent) }
    catch { /* One failed request must not stop the next scheduled attempt. */ }
    finally { if (inFlightGeneration === currentGeneration) inFlightGeneration = null }
  }

  function start() {
    if (timer !== null) return
    generation++
    timer = scheduler.setInterval(() => { void refresh(true) }, intervalMs)
    void refresh(false)
  }

  function stop() {
    if (timer !== null) scheduler.clearInterval(timer)
    timer = null
    generation++
  }

  return { start, stop, refresh }
}
