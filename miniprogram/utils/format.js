/**
 * 展示用格式化（小程序本地实现，不依赖 Intl；ISO 字符串本身带 +08:00）。
 */
export const STATUS_TEXT = {
  assigned: '待打卡',
  checked_in: '服务中',
  completed: '已完成',
}

export function statusText(status) {
  return STATUS_TEXT[status] || status || ''
}

export function dateText(iso) {
  if (!iso || iso.length < 10) return ''
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
}

export function timeText(iso) {
  if (!iso || iso.length < 16) return ''
  return iso.slice(11, 16)
}

export function distanceText(meters) {
  if (meters === null || meters === undefined || !Number.isFinite(Number(meters))) return ''
  const value = Number(meters)
  if (value < 1000) return `${value} 米`
  return `${(value / 1000).toFixed(1)} 公里`
}

export function amountText(cents) {
  if (!Number.isFinite(Number(cents))) return '—'
  return `¥${(Number(cents) / 100).toFixed(2)}`
}

export function fileSizeText(kb) {
  const value = Number(kb) || 0
  if (value < 1024) return `${value} KB`
  return `${(value / 1024).toFixed(1)} MB`
}

/** 设备当前时间 → 带 +08:00 的 ISO 字符串（与 Web 端口径一致）。 */
export function nowIso() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+08:00`
  )
}
