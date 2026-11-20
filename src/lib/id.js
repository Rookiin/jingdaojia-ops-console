/**
 * 单号 / 幂等键生成（时钟由参数注入，不调用 Date.now / Math.random）。
 */

/**
 * 左补零。
 * @param {number|string} value
 * @param {number} width
 * @returns {string}
 */
export function pad(value, width = 4) {
  return String(value).padStart(width, '0')
}

/**
 * 生成顺序 ID，例如 makeSequentialId('O', 12) → O-0012。
 * @param {string} prefix
 * @param {number} seq
 * @param {number} [width]
 * @returns {string}
 */
export function makeSequentialId(prefix, seq, width = 4) {
  return `${prefix}-${pad(seq, width)}`
}

/**
 * 生成工单展示号，例如 NJ2026100001。
 * @param {string} period 'YYYY-MM'
 * @param {number} seq
 * @returns {string}
 */
export function makeOrderNo(period, seq) {
  const compact = String(period || '').replace('-', '')
  return `NJ${compact}${pad(seq, 4)}`
}

/**
 * 生成幂等键。
 * @param {string} namespace
 * @param {Array<string|number>} parts
 * @returns {string}
 */
export function makeIdempotencyKey(namespace, parts = []) {
  return [namespace, ...parts].filter((part) => part !== null && part !== undefined).join(':')
}

/**
 * 工单创建幂等键。
 * @param {string} orderId
 * @returns {string}
 */
export function orderCreateKey(orderId) {
  return makeIdempotencyKey('create', [orderId])
}

/**
 * 赔付入账幂等键 = 赔付 ID。
 * @param {string} compensationId
 * @returns {string}
 */
export function compensationKey(compensationId) {
  return String(compensationId)
}

/**
 * 结算幂等键 = cleaner_id + order_id + period。
 * @param {string} cleanerId
 * @param {string} orderId
 * @param {string} period
 * @returns {string}
 */
export function settlementKey(cleanerId, orderId, period) {
  return makeIdempotencyKey('settle', [cleanerId, orderId, period])
}
