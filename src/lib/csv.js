/**
 * CSV 导出工具：UTF-8 BOM，避免 Excel 中文乱码（docs P10）。
 */
import { fmtDateTime, formatYuan } from './format.js'

const BOM = '\uFEFF'

/**
 * 转义单个 CSV 单元格。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

/**
 * 生成 CSV 文本（含 BOM）。
 * @param {Array<{key:string,title:string,format?:(row:Object)=>unknown}>} columns
 * @param {Object[]} rows
 * @returns {string}
 */
export function toCsv(columns, rows) {
  const header = columns.map((col) => escapeCsvCell(col.title)).join(',')
  const lines = (rows || []).map((row) =>
    columns
      .map((col) => {
        const raw = col.format ? col.format(row) : row[col.key]
        return escapeCsvCell(raw)
      })
      .join(','),
  )
  return `${BOM}${[header, ...lines].join('\r\n')}`
}

/**
 * 金额列格式化（元、两位小数）。
 * @param {number} fen
 * @returns {string}
 */
export function csvMoney(fen) {
  return formatYuan(fen, { symbol: '' }).trim()
}

/**
 * 时间列格式化。
 * @param {string} iso
 * @returns {string}
 */
export function csvDateTime(iso) {
  return fmtDateTime(iso)
}

/**
 * 浏览器下载 CSV。
 * @param {string} filename
 * @param {string} content 已含 BOM 的 CSV 文本
 */
export function downloadCsv(filename, content) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}
