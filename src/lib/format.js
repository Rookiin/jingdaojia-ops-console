/**
 * 展示格式化工具。
 *
 * 金额入参一律为“分”；展示时除以 100 并带千分位。
 * 日期统一按 Asia/Shanghai 展示，不依赖浏览器本地时区。
 */

const MONEY_FORMATTER = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN')

/**
 * 分 → 元（数值）。
 * @param {number} fen
 * @returns {number}
 */
export function toYuan(fen) {
  const n = Number(fen)
  return Number.isFinite(n) ? n / 100 : 0
}

/**
 * 分 → 元字符串，带千分位与两位小数。
 * @param {number} fen
 * @param {{symbol?: string, showSign?: boolean}} [options]
 * @returns {string}
 */
export function formatYuan(fen, options = {}) {
  const n = Number(fen)
  if (!Number.isFinite(n)) return '—'
  const symbol = options.symbol === undefined ? '¥' : options.symbol
  const sign = n < 0 ? '-' : options.showSign && n > 0 ? '+' : ''
  return `${sign}${symbol}${MONEY_FORMATTER.format(Math.abs(n) / 100)}`
}

/**
 * 比例（0–1）→ 百分比字符串。null/非数返回 '—'。
 * @param {number|null|undefined} ratio
 * @param {number} [digits]
 * @returns {string}
 */
export function toPct(ratio, digits = 1) {
  if (ratio === null || ratio === undefined) return '—'
  const n = Number(ratio)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

/**
 * 已是百分数数值（如 22）→ '22.0%'。
 * @param {number|null|undefined} pct
 * @param {number} [digits]
 * @returns {string}
 */
export function fmtPct(pct, digits = 1) {
  if (pct === null || pct === undefined) return '—'
  const n = Number(pct)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

/**
 * 普通数字千分位。
 * @param {number} value
 * @param {number} [digits]
 * @returns {string}
 */
export function fmtNumber(value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (digits > 0) return n.toFixed(digits)
  return NUMBER_FORMATTER.format(n)
}

function parseDate(value) {
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof value !== 'string' || !value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/**
 * ISO 时间 → YYYY-MM-DD（Asia/Shanghai）。
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function fmtDate(value) {
  const t = parseDate(value)
  if (t === null) return '—'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t))
}

/**
 * ISO 时间 → YYYY-MM-DD HH:mm（Asia/Shanghai）。
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function fmtDateTime(value) {
  const t = parseDate(value)
  if (t === null) return '—'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(t))
  const get = (type) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/**
 * '2026-10' → '2026 年 10 月'。
 * @param {string|null|undefined} period
 * @returns {string}
 */
export function periodLabel(period) {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}$/.test(period)) return '—'
  const [year, month] = period.split('-')
  return `${year} 年 ${Number(month)} 月`
}

/**
 * 截断字符串。
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export function truncate(value, max = 24) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}
