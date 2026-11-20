/**
 * 提成计算（纯函数，docs §3.2）。
 *
 * 金额一律使用分（整数）。不读 store / React / 时钟；时间由参数传入。
 */
import { clamp, isFiniteNumber, namedError, roundCents } from './money.js'

/**
 * @typedef {Object} CommissionInput
 * @property {string} orderId
 * @property {string} cleanerId
 * @property {number} amount            订单金额（分）
 * @property {string} checkinAt         ISO8601 +08:00
 * @property {string} completedAt       ISO8601 +08:00
 * @property {number} hourlyRate        分/小时
 * @property {number} baseRate          单量提成率 0–1
 * @property {number} qualityCoef       质量系数 0.8–1.2
 * @property {boolean} isRework         是否返工单
 * @property {boolean} [isCancelled]    是否取消
 */

/**
 * @typedef {Object} CommissionResult
 * @property {number} minutes
 * @property {number} hourlyPay
 * @property {number} orderPay
 * @property {number} basePay
 * @property {number} qualityPay
 * @property {number} total
 * @property {string[]} warnings
 */

/**
 * 计算单笔工单提成。
 *
 * @param {CommissionInput} input
 * @returns {CommissionResult}
 */
export function calcCommission(input) {
  const i = input || {}
  const warnings = []

  if (!isFiniteNumber(i.amount) || i.amount < 0) {
    throw namedError('INVALID_INPUT', 'amount 必须为非负整数分')
  }
  if (!isFiniteNumber(i.baseRate) || i.baseRate < 0 || i.baseRate > 1) {
    throw namedError('INVALID_INPUT', 'baseRate 必须位于 [0, 1]')
  }
  if (!isFiniteNumber(i.hourlyRate) || i.hourlyRate < 0) {
    throw namedError('INVALID_INPUT', 'hourlyRate 必须为非负整数分/小时')
  }

  if (i.isCancelled) {
    return {
      minutes: 0,
      hourlyPay: 0,
      orderPay: 0,
      basePay: 0,
      qualityPay: 0,
      total: 0,
      warnings,
    }
  }

  const start = Date.parse(i.checkinAt)
  const end = Date.parse(i.completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw namedError('INVALID_INPUT', 'checkinAt / completedAt 无法解析为时间')
  }

  let minutes
  const rawMinutes = Math.max(0, (end - start) / 60000)
  if (end <= start) {
    minutes = 30
    warnings.push('时间异常，按最低 30 分钟')
  } else if (rawMinutes > 480) {
    minutes = 480
    warnings.push('超 8 小时，按 480 分钟封顶')
  } else {
    minutes = clamp(Math.ceil(rawMinutes / 15) * 15, 30, 480)
  }

  let qualityCoef = i.qualityCoef
  if (!isFiniteNumber(qualityCoef)) {
    qualityCoef = 1
    warnings.push('质量系数缺失，按 1.0')
  } else if (qualityCoef < 0.8 || qualityCoef > 1.2) {
    qualityCoef = clamp(qualityCoef, 0.8, 1.2)
    warnings.push('质量系数越界已截断')
  }

  let hourlyPay = roundCents((minutes / 60) * i.hourlyRate)
  let orderPay = roundCents(i.amount * i.baseRate)

  if (i.isRework) {
    hourlyPay = roundCents(hourlyPay * 0.5)
    orderPay = 0
    warnings.push('返工单：工时按 50% 计，单量提成为 0')
  }

  const basePay = hourlyPay + orderPay
  const qualityPay = roundCents(basePay * (qualityCoef - 1))
  const total = basePay + qualityPay

  return { minutes, hourlyPay, orderPay, basePay, qualityPay, total, warnings }
}
