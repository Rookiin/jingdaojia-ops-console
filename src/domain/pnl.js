/**
 * 片区损益与堵漏模拟（纯函数，docs §3.4 / §3.5）。
 *
 * 管理口径：
 *   grossProfit = revenue − directCost
 *   leakTotal   = compensation + reworkCost + idleRunCost
 *   netProfit   = grossProfit − leakTotal − fixedCost
 *
 * 金额一律为分；比率字段为“百分数数值”（例如 22 表示 22%），分母为 0 返回 null。
 */
import { clamp, isFiniteNumber, namedError, pctOrNull, sumCents } from './money.js'

/**
 * @typedef {Object} DistrictPnlInput
 * @property {string} districtId
 * @property {string} period
 * @property {number} revenue
 * @property {number} directCost
 * @property {number} compensation
 * @property {number} reworkCost
 * @property {number} idleRunCost
 * @property {number} fixedCost
 */

/**
 * @typedef {Object} DistrictPnlResult
 * @property {number} revenue
 * @property {number} directCost
 * @property {number} grossProfit
 * @property {number} compensation
 * @property {number} reworkCost
 * @property {number} idleRunCost
 * @property {number} leakTotal
 * @property {number} fixedCost
 * @property {number} netProfit
 * @property {number|null} grossMarginPct
 * @property {number|null} netMarginPct
 * @property {number|null} leakPct
 * @property {boolean} balanced
 * @property {string[]} warnings
 */

const MONEY_FIELDS = [
  'revenue',
  'directCost',
  'compensation',
  'reworkCost',
  'idleRunCost',
  'fixedCost',
]

function readNonNegativeMoney(input, field) {
  const value = input[field] === undefined ? 0 : input[field]
  if (!isFiniteNumber(value) || value < 0) {
    throw namedError('INVALID_INPUT', `${field} 必须为非负整数分`)
  }
  return value
}

/**
 * 计算片区损益。
 *
 * @param {DistrictPnlInput} input
 * @returns {DistrictPnlResult}
 */
export function calcDistrictPnl(input) {
  const i = input || {}
  const warnings = []
  const values = {}
  for (const field of MONEY_FIELDS) values[field] = readNonNegativeMoney(i, field)

  const { revenue, directCost, compensation, reworkCost, idleRunCost, fixedCost } =
    values

  const grossProfit = revenue - directCost
  const leakTotal = sumCents([compensation, reworkCost, idleRunCost])
  const netProfit = grossProfit - leakTotal - fixedCost

  // 两路复算，差异 ≤1 分视为平衡（docs §3.4 balanced）
  const netViaItems =
    revenue -
    directCost -
    compensation -
    reworkCost -
    idleRunCost -
    fixedCost
  const balanced = Math.abs(netProfit - netViaItems) <= 1

  if (directCost > revenue) warnings.push('直接成本高于营收，毛利为负')

  return {
    revenue,
    directCost,
    grossProfit,
    compensation,
    reworkCost,
    idleRunCost,
    leakTotal,
    fixedCost,
    netProfit,
    grossMarginPct: pctOrNull(grossProfit, revenue),
    netMarginPct: pctOrNull(netProfit, revenue),
    leakPct: pctOrNull(leakTotal, revenue),
    balanced,
    warnings,
  }
}

/**
 * @typedef {Object} LeakScenario
 * @property {number} compensationDrop 0–1
 * @property {number} reworkDrop 0–1
 * @property {number} idleDrop 0–1
 */

/**
 * 堵漏模拟：按比例削减三项漏损，返回带 assumed=true 的假设损益。
 * 不写入原始账。比例为 0 时金额与 base 完全一致。
 *
 * @param {DistrictPnlResult} base
 * @param {LeakScenario} scenario
 * @returns {DistrictPnlResult & {assumed: true, scenario: LeakScenario}}
 */
export function simulateLeakReduction(base, scenario) {
  if (!base || !isFiniteNumber(base.revenue)) {
    throw namedError('INVALID_INPUT', 'base 必须为 calcDistrictPnl 的结果')
  }
  const s = scenario || {}
  const warnings = Array.isArray(base.warnings) ? [...base.warnings] : []

  const drop = (value, name) => {
    const raw = s[name]
    if (raw === undefined || raw === null) return 0
    if (!isFiniteNumber(raw)) {
      warnings.push(`${name} 异常，按 0 处理`)
      return 0
    }
    if (raw < 0 || raw > 1) warnings.push(`${name} 越界已截断到 [0,1]`)
    return clamp(raw, 0, 1)
  }

  const compensationDrop = drop('compensationDrop', 'compensationDrop')
  const reworkDrop = drop('reworkDrop', 'reworkDrop')
  const idleDrop = drop('idleDrop', 'idleDrop')

  const newComp = Math.round(base.compensation * (1 - compensationDrop))
  const newRework = Math.round(base.reworkCost * (1 - reworkDrop))
  const newIdle = Math.round(base.idleRunCost * (1 - idleDrop))
  const newLeak = sumCents([newComp, newRework, newIdle])
  const newNet = base.grossProfit - newLeak - base.fixedCost

  const balanced =
    Math.abs(
      newNet -
        (base.revenue -
          base.directCost -
          newComp -
          newRework -
          newIdle -
          base.fixedCost),
    ) <= 1

  const scenarioOut = {
    compensationDrop,
    reworkDrop,
    idleDrop,
  }

  return {
    ...base,
    compensation: newComp,
    reworkCost: newRework,
    idleRunCost: newIdle,
    leakTotal: newLeak,
    netProfit: newNet,
    netMarginPct: pctOrNull(newNet, base.revenue),
    leakPct: pctOrNull(newLeak, base.revenue),
    balanced,
    warnings,
    assumed: true,
    scenario: scenarioOut,
  }
}
