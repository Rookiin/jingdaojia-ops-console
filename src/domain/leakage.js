/**
 * 漏损归集（纯函数）：返工 / 空跑 / 赔付 → 损益科目。
 *
 * rework_record 与 idle_run_record 默认不带 district_id，需通过 order_id
 * 查订单归属；调用方可传入 orderById（Map 或普通对象）。
 */
import { periodOf } from './period.js'
import { isFiniteNumber, sumCents } from './money.js'

/**
 * @typedef {Object} LeakageInput
 * @property {Array<Object>} [reworks]
 * @property {Array<Object>} [idleRuns]
 * @property {Array<Object>} [compensations]
 * @property {Map<string, Object>|Record<string, Object>} [orderById]
 * @property {string} [period] 账期 'YYYY-MM'；不传则不过滤
 * @property {boolean} [approvedOnly] 赔付仅计 approved，默认 true
 * @property {string} [timeZone] 默认 Asia/Shanghai
 */

/**
 * @typedef {Object} LeakageResult
 * @property {number} compensation
 * @property {number} reworkCost
 * @property {number} idleRunCost
 * @property {number} leakTotal
 * @property {Record<string, {compensation:number, reworkCost:number, idleRunCost:number, leakTotal:number}>} byDistrict
 * @property {string[]} warnings
 */

function lookupOrder(orderById, orderId) {
  if (!orderById || !orderId) return null
  if (orderById instanceof Map) return orderById.get(orderId) || null
  return orderById[orderId] || null
}

function inPeriod(datetime, period, timeZone) {
  if (!period) return true
  if (!datetime) return false
  return periodOf(datetime, timeZone) === period
}

function ensureBucket(byDistrict, districtId) {
  const key = districtId || 'UNASSIGNED'
  if (!byDistrict[key]) {
    byDistrict[key] = {
      compensation: 0,
      reworkCost: 0,
      idleRunCost: 0,
      leakTotal: 0,
    }
  }
  return byDistrict[key]
}

function add(bucket, field, amount) {
  bucket[field] += amount
  bucket.leakTotal += amount
}

/**
 * 归集三项漏损，可限定账期与片区。
 *
 * @param {LeakageInput} input
 * @returns {LeakageResult}
 */
export function aggregateLeakage(input) {
  const i = input || {}
  const warnings = []
  const byDistrict = {}
  let compensation = 0
  let reworkCost = 0
  let idleRunCost = 0

  const approvedOnly = i.approvedOnly !== false

  for (const c of i.compensations || []) {
    if (!c) continue
    if (approvedOnly && c.status !== 'approved') continue
    if (!inPeriod(c.approved_at || c.decided_at, i.period, i.timeZone)) continue
    if (!isFiniteNumber(c.amount) || c.amount < 0) {
      warnings.push(`赔付 ${c.id || '(unknown)'} 金额异常，已忽略`)
      continue
    }
    compensation += c.amount
    add(ensureBucket(byDistrict, c.district_id), 'compensation', c.amount)
  }

  for (const r of i.reworks || []) {
    if (!r) continue
    if (!inPeriod(r.created_at, i.period, i.timeZone)) continue
    if (!isFiniteNumber(r.cost) || r.cost < 0) {
      warnings.push(`返工 ${r.id || '(unknown)'} 成本异常，已忽略`)
      continue
    }
    reworkCost += r.cost
    const order = lookupOrder(i.orderById, r.order_id)
    add(
      ensureBucket(byDistrict, r.district_id || order?.district_id),
      'reworkCost',
      r.cost,
    )
  }

  for (const r of i.idleRuns || []) {
    if (!r) continue
    if (!inPeriod(r.created_at, i.period, i.timeZone)) continue
    if (!isFiniteNumber(r.cost) || r.cost < 0) {
      warnings.push(`空跑 ${r.id || '(unknown)'} 成本异常，已忽略`)
      continue
    }
    idleRunCost += r.cost
    const order = lookupOrder(i.orderById, r.order_id)
    add(
      ensureBucket(byDistrict, r.district_id || order?.district_id),
      'idleRunCost',
      r.cost,
    )
  }

  return {
    compensation,
    reworkCost,
    idleRunCost,
    leakTotal: sumCents([compensation, reworkCost, idleRunCost]),
    byDistrict,
    warnings,
  }
}

/**
 * 单片区漏损归集（便捷函数）。
 * @param {LeakageInput} input
 * @param {string} districtId
 * @returns {{compensation:number, reworkCost:number, idleRunCost:number, leakTotal:number}}
 */
export function aggregateDistrictLeakage(input, districtId) {
  const result = aggregateLeakage(input)
  return (
    result.byDistrict[districtId] || {
      compensation: 0,
      reworkCost: 0,
      idleRunCost: 0,
      leakTotal: 0,
    }
  )
}
