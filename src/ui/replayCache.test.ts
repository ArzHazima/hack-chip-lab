import { describe, expect, it } from 'vitest'
import { ReplayCache, scheduleReplay, type Scheduler } from './replayCache'
import type { RunView, Snap } from './types'

const snapOf = (n: number): Snap => ({ inputs: { a: n }, outputs: { out: n }, wireValues: {} })
function runWith(replay: (i: number) => Snap | undefined): RunView {
  return { ok: true, passed: 1, total: 1, headers: [], rows: [], replay }
}
// A scheduler we control by hand: nothing runs until `flush()`.
function manual() {
  const queue: (() => void)[] = []
  const schedule: Scheduler = (fn) => {
    queue.push(fn)
    return () => {
      const i = queue.indexOf(fn)
      if (i >= 0) queue.splice(i, 1)
    }
  }
  return { schedule, flush: () => queue.splice(0).forEach((f) => f()), pending: () => queue.length }
}

describe('scheduleReplay / ReplayCache', () => {
  it('does not replay at once, only when the scheduler runs, then caches', () => {
    let calls = 0
    const run = runWith((i) => (calls++, snapOf(i)))
    const cache = new ReplayCache()
    const m = manual()
    let done = 0
    scheduleReplay(cache, run, 5, () => done++, m.schedule)
    expect(calls).toBe(0) // nothing happened during "render"
    expect(cache.get(run, 5)).toBeUndefined()
    m.flush()
    expect(calls).toBe(1)
    expect(done).toBe(1)
    expect(cache.get(run, 5)?.snap?.inputs.a).toBe(5)
  })

  it('a second click on the same row is served from the cache (no replay, nothing scheduled)', () => {
    let calls = 0
    const run = runWith((i) => (calls++, snapOf(i)))
    const cache = new ReplayCache()
    const m = manual()
    scheduleReplay(cache, run, 3, () => {}, m.schedule)
    m.flush()
    scheduleReplay(cache, run, 3, () => {}, m.schedule)
    expect(m.pending()).toBe(0)
    expect(calls).toBe(1)
  })

  it('another row replaces the cached one; another run never matches', () => {
    const run = runWith(snapOf)
    const other = runWith(snapOf)
    const cache = new ReplayCache()
    const m = manual()
    scheduleReplay(cache, run, 1, () => {}, m.schedule)
    m.flush()
    scheduleReplay(cache, run, 2, () => {}, m.schedule)
    m.flush()
    expect(cache.get(run, 1)).toBeUndefined()
    expect(cache.get(run, 2)).toBeDefined()
    expect(cache.get(other, 2)).toBeUndefined()
  })

  it('cancelling (the user clicked another row first) skips the work', () => {
    let calls = 0
    const run = runWith((i) => (calls++, snapOf(i)))
    const cache = new ReplayCache()
    const m = manual()
    const cancel = scheduleReplay(cache, run, 7, () => {}, m.schedule)
    cancel()
    m.flush()
    expect(calls).toBe(0)
    expect(cache.get(run, 7)).toBeUndefined()
  })

  it('a failing replay is cached as "no colours" so the indicator ends', () => {
    const run = runWith(() => {
      throw new Error('boom')
    })
    const cache = new ReplayCache()
    const m = manual()
    scheduleReplay(cache, run, 0, () => {}, m.schedule)
    m.flush()
    expect(cache.get(run, 0)).toEqual({ snap: undefined })
  })

  it('a run without replay (combinational table) schedules nothing', () => {
    const run: RunView = { ok: true, passed: 0, total: 0, headers: [], rows: [] }
    const m = manual()
    scheduleReplay(new ReplayCache(), run, 0, () => {}, m.schedule)
    expect(m.pending()).toBe(0)
  })
})
