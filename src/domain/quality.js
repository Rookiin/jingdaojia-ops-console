/**
 * 质量系数（纯函数，docs §3.3）。
 */
import { clamp, isFiniteNumber, namedError, round2 } from './money.js'

/**
 * @typedef {Object} QualityInput
 * @property {number} orders
 * @property {number} onTimeOrders
 * @property {number} complaintCount
 * @property {number} reworkCount
 * @property {number|null} [manualOverride]
 */

/**
 * @typedef {Object} QualityResult
 * @property {number} coef
 * @property {number|null} onTimeRate
 * @property {number|null} complaintRate
 * @property {number|null} reworkRate
 * @property {'calculated'|'override'|'default'} source
 * @property {string[]} warnings
 */

/**
 * 计算阿姨账期质量系数。
 * 公式：1 + 0.20×(按时率−0.90) − 0.50×投诉率 − 0.30×返工率，截断到 [0.80, 1.20]。
 *
 * @param {QualityInput} input
 * @returns {QualityResult}
 */
export function calcQualityCoef(input) {
  const i = input || {}
  const warnings = []
  const orders = Number(i.orders)
  if (!isFiniteNumber(orders) || orders < 0) {
    throw namedError('INVALID_INPUT', 'orders 必须为非负数')
  }

  // 人工覆盖优先
  if (i.manualOverride !== null && i.manualOverride !== undefined) {
    const override = Number(i.manualOverride)
    if (!isFiniteNumber(override)) {
      warnings.push('人工覆盖值异常，回退计算值')
    } else {
      const coef = round2(clamp(override, 0.8, 1.2))
      if (coef !== round2(override)) warnings.push('人工覆盖值越界已截断')
      const zeroRates = orders === 0
      return {
        coef,
        onTimeRate: zeroRates ? null : 0,
        complaintRate: zeroRates ? null : 0,
        reworkRate: zeroRates ? null : 0,
        source: 'override',
        warnings,
      }
    }
  }

  if (orders === 0) {
    return {
      coef: 1,
      onTimeRate: null,
      complaintRate: null,
      reworkRate: null,
      source: 'default',
      warnings,
    }
  }

  let countsClamped = false
  const sanitizeCount = (value) => {
    const n = Number(value)
    if (!isFiniteNumber(n) || n < 0) {
      countsClamped = true
      return 0
    }
    if (n > orders) {
      countsClamped = true
      return orders
    }
    return n
  }

  const onTimeOrders = sanitizeCount(i.onTimeOrders)
  const complaintCount = sanitizeCount(i.complaintCount)
  const reworkCount = sanitizeCount(i.reworkCount)
  if (countsClamped) warnings.push('计数异常')

  const onTimeRate = onTimeOrders / orders
  const complaintRate = complaintCount / orders
  const reworkRate = reworkCount / orders
  const raw =
    1 + 0.2 * (onTimeRate - 0.9) - 0.5 * complaintRate - 0.3 * reworkRate

  if (!Number.isFinite(raw)) {
    warnings.push('计算异常')
    return {
      coef: 1,
      onTimeRate,
      complaintRate,
      reworkRate,
      source: 'calculated',
      warnings,
    }
  }

  return {
    coef: round2(clamp(raw, 0.8, 1.2)),
    onTimeRate,
    complaintRate,
    reworkRate,
    source: 'calculated',
    warnings,
  }
}
