/**
 * 赔付定责与赔付金额（纯函数，docs §3.6）。
 *
 * 硬规则：
 * - 自动路径永不返回 none；无责只能由人工路径产生。
 * - 证据评分 0–100；40–69 与 <40 均为 undetermined，需人工复核。
 * - claimAmount > 300 元（30,000 分）需二次审批；> 500 元（50,000 分）需财务终审。
 */
import { isFiniteNumber, namedError } from './money.js'
import { RESPONSIBILITIES } from './types.js'

const HOUR_MS = 60 * 60 * 1000

/**
 * @typedef {Object} ResponsibilityInput
 * @property {{id:string, checkinAt:string|null, completedAt:string|null,
 *   photosBefore:string[], photosAfter:string[], signature:string|null}} order
 * @property {string} complaintAt
 * @property {number} claimAmount
 * @property {boolean} hasCustomerPrePhoto
 * @property {boolean} productDefectEvidence
 * @property {number} priorSameTypeCount
 * @property {'auto'|'manual'} source
 * @property {string} [manualReason]
 * @property {'cleaner'|'customer'|'product'|'none'|'undetermined'} [manualResponsibility]
 * @property {boolean} [hasNewDamageEvidence] 可选的“服务窗内新增损坏证据”显式输入
 */

/**
 * @typedef {Object} ResponsibilityResult
 * @property {'cleaner'|'customer'|'product'|'none'|'undetermined'} responsibility
 * @property {number} evidenceScore
 * @property {string[]} reasons
 * @property {boolean} requiresManualReview
 * @property {'district_manager'|'finance'} maxApprovalRole
 */

function parseTime(value) {
  if (!value) return NaN
  return Date.parse(value)
}

/**
 * 证据评分（0–100）。
 * E1 签到与完成 15；E2 服务前照片 15；E3 服务后照片 15；E4 签字 15；
 * E5 投诉在完成后 72h 内 20；E6 前后照片可对比 20。
 */
function scoreEvidence(input) {
  const order = input.order || {}
  const before = Array.isArray(order.photosBefore) ? order.photosBefore : []
  const after = Array.isArray(order.photosAfter) ? order.photosAfter : []
  const reasons = []
  let score = 0

  if (order.checkinAt && order.completedAt) {
    score += 15
    reasons.push('E1 有签到与完成时间 +15')
  }
  if (before.length >= 1) {
    score += 15
    reasons.push('E2 有服务前照片 +15')
  }
  if (after.length >= 1) {
    score += 15
    reasons.push('E3 有服务后照片 +15')
  }
  if (order.signature) {
    score += 15
    reasons.push('E4 有客户签字 +15')
  }

  const completed = parseTime(order.completedAt)
  const complaint = parseTime(input.complaintAt)
  const within72h =
    Number.isFinite(completed) &&
    Number.isFinite(complaint) &&
    complaint >= completed &&
    complaint - completed <= 72 * HOUR_MS
  if (within72h) {
    score += 20
    reasons.push('E5 投诉在完成后 72 小时内 +20')
  }

  if (before.length >= 1 && after.length >= 1) {
    score += 20
    reasons.push('E6 前后照片可对比 +20')
  }

  return { score: Math.min(100, score), reasons, within72h }
}

/**
 * 赔付定责。
 *
 * @param {ResponsibilityInput} input
 * @returns {ResponsibilityResult}
 */
export function decideResponsibility(input) {
  const i = input || {}
  if (!isFiniteNumber(i.claimAmount) || i.claimAmount < 0) {
    throw namedError('INVALID_INPUT', 'claimAmount 必须为非负整数分')
  }

  const { score, reasons, within72h } = scoreEvidence(i)
  const manualValue =
    i.manualResponsibility !== undefined ? i.manualResponsibility : i.manualValue
  const manualReason = typeof i.manualReason === 'string' ? i.manualReason.trim() : ''

  let responsibility = 'undetermined'
  let requiresManualReview = true

  if (i.source === 'manual' && manualReason) {
    responsibility = RESPONSIBILITIES.includes(manualValue) ? manualValue : 'none'
    requiresManualReview = false
    reasons.push(`人工定责：${responsibility}（理由：${manualReason}）`)
  } else if (i.productDefectEvidence === true) {
    responsibility = 'product'
    requiresManualReview = false
    reasons.push('命中规则 2：耗材/设备缺陷证据成立 → product')
  } else if (
    i.hasCustomerPrePhoto === true &&
    i.hasNewDamageEvidence !== true
  ) {
    responsibility = 'customer'
    requiresManualReview = false
    reasons.push('命中规则 3：客户有服务前已损坏照片且无新增损坏证据 → customer')
  } else if (score >= 70 && within72h) {
    responsibility = 'cleaner'
    // 金额 > 300 元需二次审批
    requiresManualReview = i.claimAmount > 30000
    reasons.push(`命中规则 4：证据分 ${score} ≥70 且投诉在 72h 内 → cleaner`)
  } else if (score >= 40) {
    responsibility = 'undetermined'
    requiresManualReview = true
    reasons.push(`命中规则 5：证据分 ${score} 位于 [40,70) → 待定，人工复核`)
  } else {
    responsibility = 'undetermined'
    requiresManualReview = true
    reasons.push(`命中规则 6：证据分 ${score} <40 → 待定，人工复核`)
  }

  // 同类历史仅标注，不改变责任方
  if (Number(i.priorSameTypeCount) >= 2) {
    reasons.push('该阿姨同类历史 ≥2 次，建议关注')
  }

  let maxApprovalRole = 'district_manager'
  // 硬规则：>500 元必须财务终审并人工复核
  if (i.claimAmount > 50000) {
    maxApprovalRole = 'finance'
    requiresManualReview = true
    reasons.push('金额 >500 元，需财务终审')
  }

  // 自动路径永不返回 none（防御性兜底）
  if (i.source !== 'manual' && responsibility === 'none') {
    responsibility = 'undetermined'
    requiresManualReview = true
  }

  return {
    responsibility,
    evidenceScore: score,
    reasons,
    requiresManualReview,
    maxApprovalRole,
  }
}

/**
 * 按责任方计算公司应付与追偿建议。
 *
 * @param {{claimAmount:number, responsibility:string, cap?:number}} input
 * @returns {{payable:number, recoverable:number, warnings:string[]}}
 */
export function calcCompensation(input) {
  const i = input || {}
  const claim = Number(i.claimAmount)
  if (!isFiniteNumber(claim) || claim < 0) {
    throw namedError('INVALID_INPUT', 'claimAmount 必须为非负整数分')
  }
  if (!RESPONSIBILITIES.includes(i.responsibility)) {
    throw namedError('INVALID_INPUT', '未知责任方')
  }
  const cap = isFiniteNumber(i.cap) && i.cap > 0 ? i.cap : 300000
  const warnings = []
  const capped = Math.min(claim, cap)
  if (claim > cap) warnings.push('超出赔付上限，按上限计')

  if (i.responsibility === 'cleaner') {
    warnings.push('追偿建议受当月提成 30% 上限约束，由财务执行')
    return { payable: capped, recoverable: capped, warnings }
  }
  if (i.responsibility === 'product') {
    warnings.push('向供应商追偿（系统外）')
    return { payable: capped, recoverable: 0, warnings }
  }
  if (i.responsibility === 'undetermined') {
    return { payable: capped, recoverable: 0, warnings }
  }
  return { payable: 0, recoverable: 0, warnings }
}
