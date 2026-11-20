import { describe, expect, it } from 'vitest'
import { calcQualityCoef } from '../quality.js'
import { QUALITY_CASE } from './fixtures.js'

describe('calcQualityCoef（A4 与边界）', () => {
  it('A4：60 单 / 0.96 按时 / 1 投诉 / 2 返工 → 0.99', () => {
    const r = calcQualityCoef(QUALITY_CASE)
    expect(r.coef).toBe(0.99)
    expect(r.onTimeRate).toBeCloseTo(0.96, 10)
    expect(r.complaintRate).toBeCloseTo(1 / 60, 10)
    expect(r.reworkRate).toBeCloseTo(2 / 60, 10)
    expect(r.source).toBe('calculated')
    expect(r.warnings).toEqual([])
  })

  it('零单阿姨返回默认系数 1、三项比率 null', () => {
    const r = calcQualityCoef({ orders: 0 })
    expect(r.coef).toBe(1)
    expect(r.onTimeRate).toBeNull()
    expect(r.complaintRate).toBeNull()
    expect(r.reworkRate).toBeNull()
    expect(r.source).toBe('default')
  })

  it('全勤无误 → 1.02（0.20 × 0.10）', () => {
    const r = calcQualityCoef({
      orders: 10,
      onTimeOrders: 10,
      complaintCount: 0,
      reworkCount: 0,
    })
    expect(r.coef).toBe(1.02)
  })

  it('投诉率极高时截断到下限 0.8', () => {
    const r = calcQualityCoef({
      orders: 10,
      onTimeOrders: 0,
      complaintCount: 10,
      reworkCount: 0,
    })
    expect(r.coef).toBe(0.8)
  })

  it('人工覆盖优先，并截断到 [0.8, 1.2]', () => {
    const r = calcQualityCoef({ ...QUALITY_CASE, manualOverride: 1.05 })
    expect(r.coef).toBe(1.05)
    expect(r.source).toBe('override')

    const hi = calcQualityCoef({ ...QUALITY_CASE, manualOverride: 1.5 })
    expect(hi.coef).toBe(1.2)
    expect(hi.warnings.join()).toContain('截断')
  })

  it('人工覆盖值非法时回退计算值并告警', () => {
    const r = calcQualityCoef({ ...QUALITY_CASE, manualOverride: 'abc' })
    expect(r.source).toBe('calculated')
    expect(r.coef).toBe(0.99)
    expect(r.warnings.join()).toContain('回退')
  })

  it('计数超过单量时截断到单量并告警', () => {
    const r = calcQualityCoef({
      orders: 10,
      onTimeOrders: 20,
      complaintCount: 1,
      reworkCount: 0,
    })
    expect(r.onTimeRate).toBe(1)
    expect(r.warnings.join()).toContain('计数异常')
  })

  it('负单量抛出 INVALID_INPUT', () => {
    expect(() => calcQualityCoef({ orders: -1 })).toThrow(/orders/)
    expect(() => calcQualityCoef({ orders: 'x' })).toThrow(/orders/)
  })
})
