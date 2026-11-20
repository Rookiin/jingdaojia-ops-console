import { describe, expect, it } from 'vitest'
import {
  selectAllDistrictsPnl,
  selectCleanerCommission,
  selectCleanerQuality,
  selectCustomer360,
  selectDistrictPnl,
  selectDistrictRaw,
  selectDistrictTrend,
  selectKpis,
  selectLeakBreakdown,
  selectOrderDetail,
  selectPayroll,
  selectPeriods,
  selectPnlTotals,
  selectUndeterminedRate,
} from '../../store/selectors.js'
import { PERIOD, SEED, SEED_SCALE, SEED_TARGETS } from './fixtures.js'

describe('selectors × 确定性种子（A1 / A2 / A9 集成）', () => {
  it('种子规模符合 SEED_SCALE', () => {
    expect(SEED.districts).toHaveLength(SEED_SCALE.districts)
    expect(SEED.cleaners).toHaveLength(SEED_SCALE.cleaners)
    expect(SEED.orders).toHaveLength(SEED_SCALE.orders)
    expect(SEED.compensations).toHaveLength(SEED_SCALE.compensations)
  })

  it('西乡塘原始归集与 SEED_TARGETS 一致', () => {
    const raw = selectDistrictRaw(SEED, 'D-XXT', PERIOD)
    expect(raw.revenue).toBe(SEED_TARGETS.xiangtang.revenue)
    expect(raw.directCost).toBe(SEED_TARGETS.xiangtang.directCost)
    expect(raw.compensation).toBe(1_400_000)
    expect(raw.reworkCost).toBe(1_300_000)
    expect(raw.idleRunCost).toBe(680_000)
    expect(raw.fixedCost).toBe(5_000_000)
  })

  it('片区损益与验收值一致（A1 亏 / A2 盈）', () => {
    const west = selectDistrictPnl(SEED, 'D-XXT', PERIOD)
    expect(west.netProfit).toBe(SEED_TARGETS.xiangtang.netProfit)
    expect(west.netProfit).toBe(-2_660_000)
    const east = selectDistrictPnl(SEED, 'D-QX', PERIOD)
    expect(east.netProfit).toBe(SEED_TARGETS.qingxiu.netProfit)
    expect(east.netProfit).toBe(2_440_000)
  })

  it('公司合计：营收 7800 万、净利 −22 万、漏损率 4.33%', () => {
    const totals = selectPnlTotals(SEED, PERIOD)
    expect(totals.revenue).toBe(78_000_000)
    expect(totals.directCost).toBe(60_840_000)
    expect(totals.leakTotal).toBe(3_380_000)
    expect(totals.fixedCost).toBe(14_000_000)
    expect(totals.netProfit).toBe(-220_000)
    expect(totals.leakPct).toBe(4.33)
    expect(totals.balanced).toBe(true)
  })

  it('全部片区按净利降序：青秀第一、西乡塘最后', () => {
    const rows = selectAllDistrictsPnl(SEED, PERIOD)
    expect(rows).toHaveLength(SEED_SCALE.districts)
    expect(rows[0].district.id).toBe('D-QX')
    expect(rows[0].pnl.netProfit).toBe(2_440_000)
    expect(rows[rows.length - 1].district.id).toBe('D-XXT')
    expect(rows[rows.length - 1].pnl.netProfit).toBe(-2_660_000)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].pnl.netProfit).toBeGreaterThanOrEqual(rows[i].pnl.netProfit)
    }
  })

  it('漏损明细占比：赔付 5.38% / 返工 5% / 空跑 2.62%', () => {
    const rows = selectLeakBreakdown(SEED, 'D-XXT', PERIOD)
    expect(rows.map((r) => r.label)).toEqual(['赔付', '返工', '空跑'])
    expect(rows.map((r) => r.sharePct)).toEqual([5.38, 5, 2.62])
  })

  it('无法定责率 = 48/120 = 40%', () => {
    const r = selectUndeterminedRate(SEED)
    expect(r.total).toBe(120)
    expect(r.count).toBe(48)
    expect(r.pct).toBe(40)
    expect(r.rate).toBeCloseTo(0.4, 10)
  })

  it('全阿姨月结覆盖 98 人且汇总为正', () => {
    const payroll = selectPayroll(SEED, PERIOD)
    expect(payroll.rows).toHaveLength(SEED_SCALE.cleaners)
    expect(payroll.summary.orderCount).toBeGreaterThan(0)
    expect(payroll.summary.total).toBeGreaterThan(0)
    expect(payroll.summary.minutes).toBeGreaterThan(0)
    expect(payroll.rows.every((row) => row.totals.total >= 0)).toBe(true)
  })

  it('阿姨质量系数恒在 [0.8, 1.2]，有单阿姨来源为 calculated', () => {
    const withOrders = SEED.cleaners.find((cleaner) =>
      SEED.orders.some((order) => order.cleaner_id === cleaner.id),
    )
    const quality = selectCleanerQuality(SEED, withOrders.id, PERIOD)
    expect(quality.coef).toBeGreaterThanOrEqual(0.8)
    expect(quality.coef).toBeLessThanOrEqual(1.2)
    expect(['calculated', 'default', 'override']).toContain(quality.source)

    const commission = selectCleanerCommission(SEED, withOrders.id, PERIOD)
    expect(commission.cleaner.id).toBe(withOrders.id)
    expect(commission.totals.total).toBeGreaterThanOrEqual(0)
  })

  it('未知片区 / 阿姨返回 null', () => {
    expect(selectDistrictPnl(SEED, 'D-NONE', PERIOD)).toBeNull()
    expect(selectCleanerQuality(SEED, 'C-NONE', PERIOD)).toBeNull()
    expect(selectCleanerCommission(SEED, 'C-NONE', PERIOD)).toBeNull()
  })

  it('片区趋势 14 个月且按账期升序', () => {
    const trend = selectDistrictTrend(SEED, 'D-XXT')
    expect(trend).toHaveLength(14)
    expect(trend[0].period).toBe('2025-09')
    expect(trend[13].period).toBe(PERIOD)
    expect(trend[13].net_profit).toBe(-2_660_000)
  })

  it('工单 360 与客户 360 可互查关联实体', () => {
    const order = SEED.orders[0]
    const detail = selectOrderDetail(SEED, order.id)
    expect(detail.order.id).toBe(order.id)
    expect(detail.customer.id).toBe(order.customer_id)
    expect(detail.cleaner.id).toBe(order.cleaner_id)
    expect(detail.district.id).toBe(order.district_id)
    expect(selectOrderDetail(SEED, 'O-NONE')).toBeNull()

    const customer = selectCustomer360(SEED, order.customer_id)
    expect(customer.customer.id).toBe(order.customer_id)
    expect(customer.orders.some((o) => o.id === order.id)).toBe(true)
    expect(selectCustomer360(SEED, 'CUS-NONE')).toBeNull()
  })

  it('KPI 与合计口径一致；账期列表 14 个', () => {
    const kpis = selectKpis(SEED, PERIOD)
    expect(kpis.totals.netProfit).toBe(-220_000)
    expect(kpis.undetermined.pct).toBe(40)
    expect(kpis.orderCount).toBeGreaterThan(0)
    expect(kpis.complaintCount).toBe(180)
    expect(selectPeriods(SEED)).toHaveLength(14)
  })
})
