import { describe, it, expect, beforeEach } from 'bun:test'
import { hydrateStorage } from '../storage.js'
import { createPoints } from '../points.js'

/*
 * The one number that only grows. The lobby draws it before the socket is up
 * (from storage), then the server's word replaces it.
 */
describe('points', () => {
  beforeEach(async () => {
    await hydrateStorage({ load: async () => ({}), set: () => {} })
  })

  it('starts from the stored total and takes the server total over it', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:points-v1': '42' }), set: () => {} })
    const p = createPoints()
    expect(p.total.value).toBe(42)
    p.setTotal(50)
    expect(p.total.value).toBe(50)
  })

  it('starts at zero with nothing stored or garbage stored', async () => {
    expect(createPoints().total.value).toBe(0)
    await hydrateStorage({ load: async () => ({ 'wheee:points-v1': 'lots' }), set: () => {} })
    expect(createPoints().total.value).toBe(0)
  })

  it('an award moves the total and remembers what was earned until cleared', () => {
    const p = createPoints()
    p.award({ earned: 7, total: 19 })
    expect(p.total.value).toBe(19)
    expect(p.lastEarned.value).toBe(7)
    p.clearAward()
    expect(p.lastEarned.value).toBeNull()
    expect(p.total.value).toBe(19)
  })
})
