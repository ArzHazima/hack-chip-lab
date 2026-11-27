// Row replay without freezing the page (M2).
//
// Clicking a row of a long script re-runs the script up to that row (RunView.replay). That can take a while, so it must
// NOT happen while React renders. App asks `scheduleReplay` to do it a moment later (after the browser painted a
// "computing..." note) and keeps the last result in a `ReplayCache`, so clicking the same row again is instant.

import type { RunView, Snap } from './types'

/** The result of one replay. `snap` is undefined when the script could not be replayed (the board just shows no colours). */
export interface ReplayEntry {
  snap: Snap | undefined
}

/** Remembers ONE replay: the last (run, row) pair. A new run is a new object, so an old entry can never match it. */
export class ReplayCache {
  private run: RunView | null = null
  private index = -1
  private entry: ReplayEntry | null = null

  get(run: RunView, index: number): ReplayEntry | undefined {
    return this.run === run && this.index === index && this.entry ? this.entry : undefined
  }

  set(run: RunView, index: number, entry: ReplayEntry): void {
    this.run = run
    this.index = index
    this.entry = entry
  }
}

/** Runs `fn` later and returns a function that cancels it. */
export type Scheduler = (fn: () => void) => () => void

/**
 * Default: wait for the next frame (so the "computing..." text is painted first), then one more task
 * so the browser can handle input between the paint and the heavy work.
 */
export const defaultScheduler: Scheduler = (fn) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0)
  })
  return () => {
    cancelAnimationFrame(frame)
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Replays row `index` of `run` outside the render. Does nothing when the cache already holds the answer
 * (then `onDone` is not called either: the caller reads the cache). Returns a cancel function, to be used
 * when the user clicks another row first.
 */
export function scheduleReplay(
  cache: ReplayCache,
  run: RunView,
  index: number,
  onDone: () => void,
  schedule: Scheduler = defaultScheduler,
): () => void {
  if (!run.replay || cache.get(run, index)) return () => {}
  let cancelled = false
  const cancel = schedule(() => {
    if (cancelled) return
    let snap: Snap | undefined
    try {
      snap = run.replay?.(index)
    } catch {
      snap = undefined
    }
    cache.set(run, index, { snap })
    onDone()
  })
  return () => {
    cancelled = true
    cancel()
  }
}
