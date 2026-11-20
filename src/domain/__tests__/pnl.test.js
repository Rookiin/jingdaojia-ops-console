import { describe, expect, it } from 'vitest'
import { calcDistrictPnl, simulateLeakReduction } from '../pnl.js'
import { A5_SCENARIO, PNL_INPUTS } from './fixtures.js'

describe('calcDistrictPnl（A1 / A2 与边界）', () => {
  it('A1：西乡塘 26.00 万营收 → 净利 −2.66 万、漏损率 13%', () => {
    const r = calcDistrictPnl(PNL_INPUTS.xiangtang)
    expect(r.revenue).toBe(26_000_000)
    expect(r.directCost).toBe(20_280_000)
    expect(r.grossProfit).toBe(5_720_000)
    expect(r.compensation).toBe(1_400_000)
    expect(r.reworkCost).toBe(1_300_000)
    expect(r.idleRunCost).toBe(680_000)
    expect(r.leakTotal).toBe(3_380_000)
    expect(r.fixedCost).toBe(5_000_000)
    expect(r.netProfit).toBe(-2_660_000)
    expect(r.grossMarginPct).toBe(22)
    expect(r.netMarginPct).toBe(-10.23)
    expect(r.leakPct).toBe(13)
    expect(r.balanced).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('A2：青秀 52.00 万营收 → 净利 +2.44 万、零漏损', () => {
    const r = calcDistrictPnl(PNL_INPUTS.qingxiu)
    expect(r.grossProfit).toBe(11_440_000)
    expect(r.leakTotal).toBe(0)
    expect(r.netProfit).toBe(2_440_000)
    expect(r.netMarginPct).toBe(4.69)
    expect(r.leakPct).toBe(0)
    expect(r.balanced).toBe(true)
  })

  it('A5：赔付 −30% / 返工 −25% / 空跑 −40% → 新净利 −1.643 万、新漏损 2.363 万', () => {
    const base = calcDistrictPnl(PNL_INPUTS.xiangtang)
    const r = simulateLeakReduction(base, A5_SCENARIO)
    expect(r.compensation).toBe(980_000)
    expect(r.reworkCost).toBe(975_000)
    expect(r.idleRunCost).toBe(408_000)
    expect(r.leakTotal).toBe(2_363_000)
    expect(r.grossProfit).toBe(base.grossProfit)
    expect(r.netProfit).toBe(-1_643_000)
    expect(r.netMarginPct).toBe(-6.32)
    expect(r.leakPct).toBe(9.09)
    expect(r.assumed).toBe(true)
    expect(r.scenario).toEqual(A5_SCENARIO)
    expect(r.balanced).toBe(true)
  })

  it('零削减时金额与 base 完全一致（仅标记 assumed）', () => {
    const base = calcDistrictPnl(PNL_INPUTS.xiangtang)
    const r = simulateLeakReduction(base, {})
    expect(r.netProfit).toBe(base.netProfit)
    expect(r.leakTotal).toBe(base.leakTotal)
    expect(r.assumed).toBe(true)
  })

  it('削减比例越界截断到 [0,1] 并告警；非数字按 0 处理并告警', () => {
    const base = calcDistrictPnl(PNL_INPUTS.xiangtang)
    const r = simulateLeakReduction(base, {
      compensationDrop: 1.5,
      reworkDrop: 'x',
      idleDrop: -0.2,
    })
    expect(r.compensation).toBe(0)
    expect(r.reworkCost).toBe(1_300_000)
    expect(r.idleRunCost).toBe(680_000)
    expect(r.warnings.join()).toContain('compensationDrop 越界')
    expect(r.warnings.join()).toContain('idleDrop 越界')
    expect(r.warnings.join()).toContain('reworkDrop 异常')
  })

  it('base 非法时抛出 INVALID_INPUT', () => {
    expect(() => simulateLeakReduction(null, {})).toThrow(/base/)
    expect(() => simulateLeakReduction({ revenue: 'x' }, {})).toThrow(/base/)
  })

  it('缺省金额按 0；负数/非数字抛 INVALID_INPUT', () => {
    const r = calcDistrictPnl({ districtId: 'D-T', period: '2026-10', revenue: 100 })
    expect(r.directCost).toBe(0)
    expect(r.netProfit).toBe(100)
    expect(() => calcDistrictPnl({ revenue: -1 })).toThrow(/revenue/)
    expect(() => calcDistrictPnl({ revenue: 1, fixedCost: 'x' })).toThrow(/fixedCost/)
  })

  it('直接成本高于营收时告警且毛利率为负', () => {
    const r = calcDistrictPnl({ revenue: 100, directCost: 200 })
    expect(r.grossMarginPct).toBe(-100)
    expect(r.warnings.join()).toContain('毛利为负')
  })

  it('可选字段齐全但营收为 0 时比率返回 null 而非 NaN', () => {
    const r = calcDistrictPnl({ revenue: 0, directCost: 0, fixedCost: 0 })
    expect(r.netMarginPct).toBeNull()
    expect(r.leakPct).toBeNull()
  })
})
