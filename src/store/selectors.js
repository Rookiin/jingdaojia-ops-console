/**
 * 派生数据（纯函数式 selector）。
 *
 * 纪律：损益/提成/质量系数**不持久化**，由本文件按账期实时调用 domain 计算。
 * selector 不修改 state。注意：本文件多数 selector 返回**新对象**，不要直接
 * 传给 useStore（会导致 getSnapshot 每次新引用）；推荐：
 *   const state = useStore((s) => s)
 *   const pnl = useMemo(() => selectDistrictPnl(state, id, period), [state, id, period])
 */
import { calcCommission } from '../domain/commission.js'
import { calcQualityCoef } from '../domain/quality.js'
import { calcDistrictPnl } from '../domain/pnl.js'
import { aggregateLeakage } from '../domain/leakage.js'
import { periodOf } from '../domain/period.js'
import { pctOrNull, roundCents } from '../domain/money.js'

const REVENUE_STATUS = new Set(['completed', 'closed'])
const FIFTEEN_MIN_MS = 15 * 60 * 1000

function sumBy(items, getter) {
  let total = 0
  for (const item of items) total += Number(getter(item)) || 0
  return total
}

function orderIndex(state) {
  return new Map((state.orders || []).map((order) => [order.id, order]))
}

function isRevenueOrder(order, districtId, period) {
  return (
    order &&
    order.district_id === districtId &&
    !order.is_rework &&
    REVENUE_STATUS.has(order.status) &&
    periodOf(order.completed_at) === period
  )
}

/**
 * 账期 + 片区的原始归集数（未做损益计算）。
 * @param {Object} state
 * @param {string} districtId
 * @param {string} period
 */
export function selectDistrictRaw(state, districtId, period) {
  const district = (state.districts || []).find((d) => d.id === districtId)
  if (!district) return null

  const orders = state.orders || []
  const orderById = orderIndex(state)
  const revenue = sumBy(
    orders.filter((order) => isRevenueOrder(order, districtId, period)),
    (order) => order.amount,
  )

  const leakage = aggregateLeakage({
    reworks: state.reworks,
    idleRuns: state.idleRuns,
    compensations: state.compensations,
    orderById,
    period,
    approvedOnly: true,
  })
  const bucket =
    leakage.byDistrict[districtId] || {
      compensation: 0,
      reworkCost: 0,
      idleRunCost: 0,
      leakTotal: 0,
    }

  return {
    districtId,
    period,
    revenue,
    directCost: roundCents(revenue * (district.direct_cost_rate ?? 0.78)),
    compensation: bucket.compensation,
    reworkCost: bucket.reworkCost,
    idleRunCost: bucket.idleRunCost,
    fixedCost: district.fixed_cost_monthly || 0,
  }
}

/**
 * 片区损益。
 * @param {Object} state
 * @param {string} districtId
 * @param {string} period
 */
export function selectDistrictPnl(state, districtId, period) {
  const raw = selectDistrictRaw(state, districtId, period)
  if (!raw) return null
  return calcDistrictPnl(raw)
}

/**
 * 全部片区损益（按净利降序）。
 * @param {Object} state
 * @param {string} period
 */
export function selectAllDistrictsPnl(state, period) {
  return (state.districts || [])
    .map((district) => ({
      district,
      pnl: selectDistrictPnl(state, district.id, period),
    }))
    .filter((row) => row.pnl)
    .sort((a, b) => b.pnl.netProfit - a.pnl.netProfit)
}

/**
 * 公司总览：汇总两 pilot 片区。
 * @param {Object} state
 * @param {string} period
 */
export function selectPnlTotals(state, period) {
  const raw = (state.districts || [])
    .map((district) => selectDistrictRaw(state, district.id, period))
    .filter(Boolean)

  const total = raw.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      directCost: acc.directCost + row.directCost,
      compensation: acc.compensation + row.compensation,
      reworkCost: acc.reworkCost + row.reworkCost,
      idleRunCost: acc.idleRunCost + row.idleRunCost,
      fixedCost: acc.fixedCost + row.fixedCost,
    }),
    {
      revenue: 0,
      directCost: 0,
      compensation: 0,
      reworkCost: 0,
      idleRunCost: 0,
      fixedCost: 0,
    },
  )

  return calcDistrictPnl({ districtId: 'ALL', period, ...total })
}

/**
 * 漏损科目明细（用于损益下钻）。
 * @param {Object} state
 * @param {string} districtId
 * @param {string} period
 */
export function selectLeakBreakdown(state, districtId, period) {
  const raw = selectDistrictRaw(state, districtId, period)
  if (!raw) return []
  return [
    { key: 'compensation', label: '赔付', amount: raw.compensation },
    { key: 'reworkCost', label: '返工', amount: raw.reworkCost },
    { key: 'idleRunCost', label: '空跑', amount: raw.idleRunCost },
  ].map((item) => ({
    ...item,
    sharePct: pctOrNull(item.amount, raw.revenue),
  }))
}

/**
 * 片区趋势（来自 monthly_summary，不迁移明细）。
 * @param {Object} state
 * @param {string} districtId
 */
export function selectDistrictTrend(state, districtId) {
  return (state.monthlySummary || [])
    .filter((row) => row.district_id === districtId)
    .slice()
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
}

/**
 * 阿姨账期质量系数。
 * @param {Object} state
 * @param {string} cleanerId
 * @param {string} period
 */
export function selectCleanerQuality(state, cleanerId, period) {
  const cleaner = (state.cleaners || []).find((c) => c.id === cleanerId)
  if (!cleaner) return null

  const orders = (state.orders || []).filter(
    (order) =>
      order.cleaner_id === cleanerId &&
      REVENUE_STATUS.has(order.status) &&
      periodOf(order.completed_at) === period,
  )
  const orderIds = new Set(orders.map((order) => order.id))

  const onTimeOrders = orders.filter((order) => {
    const scheduled = Date.parse(order.scheduled_at)
    const checkin = Date.parse(order.checkin_at)
    if (!Number.isFinite(scheduled) || !Number.isFinite(checkin)) return false
    return Math.abs(checkin - scheduled) <= FIFTEEN_MIN_MS
  }).length

  const complaintCount = (state.complaints || []).filter(
    (complaint) =>
      orderIds.has(complaint.order_id) &&
      periodOf(complaint.created_at) === period,
  ).length

  const orderById = orderIndex(state)
  const reworkCount = (state.reworks || []).filter((record) => {
    const original = orderById.get(record.order_id)
    return (
      original &&
      original.cleaner_id === cleanerId &&
      periodOf(record.created_at) === period
    )
  }).length

  return calcQualityCoef({
    orders: orders.length,
    onTimeOrders,
    complaintCount,
    reworkCount,
    manualOverride: cleaner.quality_coef_override,
  })
}

/**
 * 阿姨账期提成明细（逐单调用 calcCommission）。
 * @param {Object} state
 * @param {string} cleanerId
 * @param {string} period
 */
export function selectCleanerCommission(state, cleanerId, period) {
  const cleaner = (state.cleaners || []).find((c) => c.id === cleanerId)
  if (!cleaner) return null
  const quality = selectCleanerQuality(state, cleanerId, period) || {
    coef: 1,
    source: 'default',
    warnings: [],
  }

  const orders = (state.orders || [])
    .filter(
      (order) =>
        order.cleaner_id === cleanerId &&
        REVENUE_STATUS.has(order.status) &&
        periodOf(order.completed_at) === period,
    )
    .slice()
    .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))

  const lines = []
  for (const order of orders) {
    if (!order.checkin_at || !order.completed_at) continue
    const result = calcCommission({
      orderId: order.id,
      cleanerId: cleaner.id,
      amount: order.amount,
      checkinAt: order.checkin_at,
      completedAt: order.completed_at,
      hourlyRate: cleaner.hourly_rate,
      baseRate: cleaner.base_rate,
      qualityCoef: quality.coef,
      isRework: order.is_rework,
    })
    lines.push({ order, result })
  }

  const totals = lines.reduce(
    (acc, { result }) => ({
      minutes: acc.minutes + result.minutes,
      hourlyPay: acc.hourlyPay + result.hourlyPay,
      orderPay: acc.orderPay + result.orderPay,
      basePay: acc.basePay + result.basePay,
      qualityPay: acc.qualityPay + result.qualityPay,
      total: acc.total + result.total,
    }),
    {
      minutes: 0,
      hourlyPay: 0,
      orderPay: 0,
      basePay: 0,
      qualityPay: 0,
      total: 0,
    },
  )

  return { cleaner, period, quality, lines, totals }
}

/**
 * 全阿姨月结。
 * @param {Object} state
 * @param {string} period
 */
export function selectPayroll(state, period) {
  const rows = (state.cleaners || [])
    .map((cleaner) => selectCleanerCommission(state, cleaner.id, period))
    .filter(Boolean)
  const summary = rows.reduce(
    (acc, row) => ({
      minutes: acc.minutes + row.totals.minutes,
      hourlyPay: acc.hourlyPay + row.totals.hourlyPay,
      orderPay: acc.orderPay + row.totals.orderPay,
      qualityPay: acc.qualityPay + row.totals.qualityPay,
      total: acc.total + row.totals.total,
      orderCount: acc.orderCount + row.lines.length,
    }),
    {
      minutes: 0,
      hourlyPay: 0,
      orderPay: 0,
      qualityPay: 0,
      total: 0,
      orderCount: 0,
    },
  )
  return { period, rows, summary }
}

/**
 * 无法定责率（赔付责任 = undetermined）。
 * @param {Object} state
 */
export function selectUndeterminedRate(state) {
  const list = state.compensations || []
  const undetermined = list.filter((c) => c.responsibility === 'undetermined').length
  return {
    count: undetermined,
    total: list.length,
    rate: list.length === 0 ? null : undetermined / list.length,
    pct: pctOrNull(undetermined, list.length),
  }
}

/**
 * 工单 360 详情。
 * @param {Object} state
 * @param {string} orderId
 */
export function selectOrderDetail(state, orderId) {
  const order = (state.orders || []).find((o) => o.id === orderId)
  if (!order) return null
  return {
    order,
    customer: (state.customers || []).find((c) => c.id === order.customer_id) || null,
    cleaner: (state.cleaners || []).find((c) => c.id === order.cleaner_id) || null,
    district: (state.districts || []).find((d) => d.id === order.district_id) || null,
    complaints: (state.complaints || []).filter((c) => c.order_id === orderId),
    compensations: (state.compensations || []).filter((c) => c.order_id === orderId),
    reworks: (state.reworks || []).filter(
      (r) => r.order_id === orderId || r.rework_order_id === orderId,
    ),
    idleRuns: (state.idleRuns || []).filter((r) => r.order_id === orderId),
  }
}

/**
 * 客户 360。
 * @param {Object} state
 * @param {string} customerId
 */
export function selectCustomer360(state, customerId) {
  const customer = (state.customers || []).find((c) => c.id === customerId)
  if (!customer) return null
  const orderById = new Map((state.orders || []).map((o) => [o.id, o]))
  return {
    customer,
    orders: (state.orders || [])
      .filter((o) => o.customer_id === customerId)
      .slice()
      .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1)),
    complaints: (state.complaints || []).filter((c) => c.customer_id === customerId),
    compensations: (state.compensations || []).filter((c) => {
      const order = orderById.get(c.order_id)
      return order && order.customer_id === customerId
    }),
  }
}

/**
 * 首页/总览 KPI。
 * @param {Object} state
 * @param {string} period
 */
export function selectKpis(state, period) {
  const totals = selectPnlTotals(state, period)
  const undetermined = selectUndeterminedRate(state)
  const orders = (state.orders || []).filter(
    (order) =>
      REVENUE_STATUS.has(order.status) && periodOf(order.completed_at) === period,
  )
  return {
    period,
    totals,
    orderCount: orders.length,
    reworkOrderCount: orders.filter((order) => order.is_rework).length,
    complaintCount: (state.complaints || []).filter(
      (complaint) => periodOf(complaint.created_at) === period,
    ).length,
    undetermined,
  }
}

/**
 * 可选账期列表。
 * @param {Object} state
 */
export function selectPeriods(state) {
  const configured = state.config?.periods
  if (Array.isArray(configured) && configured.length > 0) return configured
  return [...new Set((state.monthlySummary || []).map((row) => row.period))].sort()
}
