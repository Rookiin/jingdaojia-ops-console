import { describe, expect, it } from 'vitest'
import { calcCommission } from '../commission.js'
import { COMMISSION_CASE } from './fixtures.js'

function call(overrides = {}) {
  return calcCommission({ ...COMMISSION_CASE, ...overrides })
}

describe('calcCommission（A3 与边界）', () => {
  it('A3：120 分钟 × 25 元/h + 150 元 × 15% + 系数 1.05 = 7613 分', () => {
    const r = call()
    expect(r.minutes).toBe(120)
    expect(r.hourlyPay).toBe(5_000)
    expect(r.orderPay).toBe(2_250)
    expect(r.basePay).toBe(7_250)
    expect(r.qualityPay).toBe(363)
    expect(r.total).toBe(7_613)
    expect(r.warnings).toEqual([])
  })

  it('完成时间不晚于签到时间：按最低 30 分钟并告警', () => {
    const r = call({
      checkinAt: '2026-10-15T11:00:00+08:00',
      completedAt: '2026-10-15T11:00:00+08:00',
    })
    expect(r.minutes).toBe(30)
    expect(r.hourlyPay).toBe(1_250)
    expect(r.warnings.join()).toContain('30 分钟')
  })

  it('工时按 15 分钟向上取整：61 分钟 → 75 分钟', () => {
    const r = call({
      checkinAt: '2026-10-15T09:00:00+08:00',
      completedAt: '2026-10-15T10:01:00+08:00',
    })
    expect(r.minutes).toBe(75)
    expect(r.hourlyPay).toBe(3_125)
  })

  it('超过 8 小时封顶 480 分钟并告警', () => {
    const r = call({
      checkinAt: '2026-10-15T09:00:00+08:00',
      completedAt: '2026-10-15T19:00:00+08:00',
    })
    expect(r.minutes).toBe(480)
    expect(r.hourlyPay).toBe(20_000)
    expect(r.warnings.join()).toContain('480')
  })

  it('返工单：工时按 50%，单量提成为 0', () => {
    const r = call({ isRework: true })
    expect(r.hourlyPay).toBe(2_500)
    expect(r.orderPay).toBe(0)
    expect(r.basePay).toBe(2_500)
    expect(r.qualityPay).toBe(125)
    expect(r.total).toBe(2_625)
    expect(r.warnings.join()).toContain('返工')
  })

  it('取消单不产生任何提成', () => {
    const r = call({ isCancelled: true })
    expect(r).toEqual({
      minutes: 0,
      hourlyPay: 0,
      orderPay: 0,
      basePay: 0,
      qualityPay: 0,
      total: 0,
      warnings: [],
    })
  })

  it('质量系数缺失按 1.0 并告警', () => {
    const r = call({ qualityCoef: undefined })
    expect(r.qualityPay).toBe(0)
    expect(r.total).toBe(7_250)
    expect(r.warnings.join()).toContain('1.0')
  })

  it('质量系数越界截断到 [0.8, 1.2] 并告警', () => {
    const r = call({ qualityCoef: 1.5 })
    expect(r.qualityPay).toBe(1_450)
    expect(r.total).toBe(8_700)
    expect(r.warnings.join()).toContain('截断')
  })

  it('非法金额 / 提成率 / 时薪抛出 INVALID_INPUT', () => {
    expect(() => calcCommission({ ...COMMISSION_CASE, amount: -1 })).toThrow(/amount/)
    expect(() => calcCommission({ ...COMMISSION_CASE, baseRate: 2 })).toThrow(/baseRate/)
    expect(() => calcCommission({ ...COMMISSION_CASE, hourlyRate: -1 })).toThrow(/hourlyRate/)
    try {
      calcCommission({ ...COMMISSION_CASE, amount: 'x' })
      expect.unreachable('应当抛错')
    } catch (err) {
      expect(err.code).toBe('INVALID_INPUT')
    }
  })

  it('非法时间抛出 INVALID_INPUT', () => {
    expect(() => calcCommission({ ...COMMISSION_CASE, checkinAt: 'x' })).toThrow(/时间/)
    expect(() => calcCommission({ ...COMMISSION_CASE, completedAt: null })).toThrow(/时间/)
  })
})
