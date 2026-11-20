/**
 * 账期归属（纯函数，docs §3.4 / P2）。
 *
 * 所有时间均按业务时区 Asia/Shanghai 判断，不依赖浏览器本地时区，
 * 不调用 Date.now()；当前时间/账期由调用方注入。
 */
import { namedError } from './money.js'

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/** 业务时区固定 UTC+8，无夏令时；算术实现避免依赖小程序 Intl。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function formatShanghai(timestamp) {
  const date = new Date(timestamp + SHANGHAI_OFFSET_MS)
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
  }
}

function formatWithIntl(timestamp, timeZone) {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    return null
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(timestamp))
  return {
    year: parts.find((p) => p.type === 'year')?.value,
    month: parts.find((p) => p.type === 'month')?.value,
  }
}

function formatParts(timestamp, timeZone) {
  if (timeZone === DEFAULT_TIME_ZONE) return formatShanghai(timestamp)
  return formatWithIntl(timestamp, timeZone)
}

/**
 * 将 ISO8601 时间归属到 'YYYY-MM' 账期。
 * 非法/空时间返回 null。
 *
 * @param {string|null|undefined} datetime
 * @param {string} [timeZone]
 * @returns {string|null}
 */
export function periodOf(datetime, timeZone = DEFAULT_TIME_ZONE) {
  if (!datetime) return null
  const timestamp = Date.parse(datetime)
  if (!Number.isFinite(timestamp)) return null
  const parts = formatParts(timestamp, timeZone)
  if (!parts) return null
  const { year, month } = parts
  if (!year || !month) return null
  return `${year}-${month}`
}

/**
 * 判断时间是否落在指定账期。
 * @param {string|null|undefined} datetime
 * @param {string} period 'YYYY-MM'
 * @param {string} [timeZone]
 * @returns {boolean}
 */
export function isInPeriod(datetime, period, timeZone = DEFAULT_TIME_ZONE) {
  return periodOf(datetime, timeZone) === period
}

/**
 * 校验账期字符串。
 * @param {string} period
 * @returns {string}
 */
export function assertPeriod(period) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw namedError('INVALID_INPUT', 'period 必须为 YYYY-MM')
  }
  return period
}

/**
 * 从起始账期生成连续 count 个账期（含起始）。
 * 例：monthSequence('2025-09', 14) → 2025-09 … 2026-10。
 *
 * @param {string} startPeriod
 * @param {number} count
 * @returns {string[]}
 */
export function monthSequence(startPeriod, count) {
  assertPeriod(startPeriod)
  const n = Math.max(0, Math.floor(Number(count) || 0))
  let [year, month] = startPeriod.split('-').map(Number)
  const out = []
  for (let i = 0; i < n; i += 1) {
    out.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return out
}

/**
 * 比较两个账期：负数 a<b，0 相等，正数 a>b。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function comparePeriod(a, b) {
  assertPeriod(a)
  assertPeriod(b)
  return a < b ? -1 : a > b ? 1 : 0
}
