import { describe, expect, it } from 'vitest'
import { aggregateDistrictLeakage, aggregateLeakage } from '../leakage.js'

const PERIOD = '2026-10'

const orders = [
  { id: 'O-W', district_id: 'D-W' },
  { id: 'O-Q', district_id: 'D-Q' },
]
const orderById = new Map(orders.map((o) => [o.id, o]))

function baseInput(overrides = {}) {
  return {
    compensations: [
      {
        id: 'C-1',
        order_id: 'O-W',
        district_id: 'D-W',
        amount: 100_000,
        status: 'approved',
        approved_at: '2026-10-05T10:00:00+08:00',
      },
      {
        id: 'C-2',
        order_id: 'O-W',
        district_id: 'D-W',
        amount: 900_000,
        status: 'pending_approval',
        approved_at: null,
      },
      {
        id: 'C-3',
        order_id: 'O-Q',
        district_id: 'D-Q',
        amount: 50_000,
        status: 'approved',
        approved_at: '2026-09-05T10:00:00+08:00',
      },
    ],
    reworks: [
      { id: 'R-1', order_id: 'O-W', cost: 20_000, created_at: '2026-10-10T10:00:00+08:00' },
      { id: 'R-2', order_id: 'O-Q', cost: 30_000, created_at: '2026-10-11T10:00:00+08:00' },
    ],
    idleRuns: [
      { id: 'I-1', order_id: 'O-W', cost: 5_000, created_at: '2026-10-12T10:00:00+08:00' },
    ],
    orderById,
    period: PERIOD,
    ...overrides,
  }
}

describe('aggregateLeakage（漏损归集）', () => {
  it('默认只计已审批赔付，并按账期过滤', () => {
    const r = aggregateLeakage(baseInput())
    expect(r.compensation).toBe(100_000) // C-2 未审批、C-3 跨账期
    expect(r.reworkCost).toBe(50_000)
    expect(r.idleRunCost).toBe(5_000)
    expect(r.leakTotal).toBe(155_000)
    expect(r.warnings).toEqual([])
  })

  it('approvedOnly=false 时计入待审批赔付（仍受账期约束）', () => {
    const r = aggregateLeakage(baseInput({ approvedOnly: false }))
    expect(r.compensation).toBe(100_000) // C-2 的 approved_at 为 null → 不计入
    const withDate = baseInput({
      approvedOnly: false,
      compensations: [
        {
          id: 'C-2',
          order_id: 'O-W',
          amount: 900_000,
          status: 'pending_approval',
          decided_at: '2026-10-06T10:00:00+08:00',
        },
      ],
      reworks: [],
      idleRuns: [],
    })
    expect(aggregateLeakage(withDate).compensation).toBe(900_000)
  })

  it('返工/空跑缺 district_id 时按 order_id 回查片区', () => {
    const r = aggregateLeakage(baseInput())
    expect(r.byDistrict['D-W']).toEqual({
      compensation: 100_000,
      reworkCost: 20_000,
      idleRunCost: 5_000,
      leakTotal: 125_000,
    })
    expect(r.byDistrict['D-Q'].reworkCost).toBe(30_000)
  })

  it('既无 district_id 也查不到订单时归入 UNASSIGNED', () => {
    const r = aggregateLeakage({
      reworks: [{ id: 'R-X', order_id: 'O-UNKNOWN', cost: 7_000, created_at: '2026-10-01T10:00:00+08:00' }],
      period: PERIOD,
      orderById: {},
    })
    expect(r.byDistrict.UNASSIGNED.reworkCost).toBe(7_000)
  })

  it('orderById 支持普通对象', () => {
    const r = aggregateLeakage({
      reworks: [{ id: 'R-1', order_id: 'O-W', cost: 1_000, created_at: '2026-10-10T10:00:00+08:00' }],
      period: PERIOD,
      orderById: { 'O-W': { id: 'O-W', district_id: 'D-W' } },
    })
    expect(r.byDistrict['D-W'].reworkCost).toBe(1_000)
  })

  it('非法金额忽略并告警，不污染合计', () => {
    const r = aggregateLeakage({
      compensations: [
        { id: 'C-BAD', amount: 'x', status: 'approved', approved_at: '2026-10-01T10:00:00+08:00' },
        { id: 'C-NEG', amount: -5, status: 'approved', approved_at: '2026-10-01T10:00:00+08:00' },
      ],
      reworks: [{ id: 'R-BAD', order_id: 'O-W', cost: null, created_at: '2026-10-01T10:00:00+08:00' }],
      idleRuns: [{ id: 'I-BAD', order_id: 'O-W', cost: Number.NaN, created_at: '2026-10-01T10:00:00+08:00' }],
      orderById,
      period: PERIOD,
    })
    expect(r.leakTotal).toBe(0)
    expect(r.warnings).toHaveLength(4)
    expect(r.warnings.join()).toContain('C-BAD')
    expect(r.warnings.join()).toContain('I-BAD')
  })

  it('不传 period 时不做账期过滤；空输入返回全零', () => {
    const noFilter = aggregateLeakage({ compensations: baseInput().compensations })
    expect(noFilter.compensation).toBe(150_000)

    const empty = aggregateLeakage({})
    expect(empty).toMatchObject({
      compensation: 0,
      reworkCost: 0,
      idleRunCost: 0,
      leakTotal: 0,
      byDistrict: {},
      warnings: [],
    })
  })

  it('aggregateDistrictLeakage 返回单片区桶，不存在时返回全零桶', () => {
    const w = aggregateDistrictLeakage(baseInput(), 'D-W')
    expect(w.leakTotal).toBe(125_000)
    const missing = aggregateDistrictLeakage(baseInput(), 'D-NONE')
    expect(missing).toEqual({ compensation: 0, reworkCost: 0, idleRunCost: 0, leakTotal: 0 })
  })

  it('UTC 时间按上海时区归期（月末边界）', () => {
    const r = aggregateLeakage({
      reworks: [
        { id: 'R-IN', order_id: 'O-W', cost: 1_000, created_at: '2026-10-31T15:30:00Z' },
        { id: 'R-OUT', order_id: 'O-W', cost: 2_000, created_at: '2026-10-31T16:30:00Z' },
      ],
      orderById,
      period: '2026-10',
    })
    expect(r.reworkCost).toBe(1_000)
  })
})
