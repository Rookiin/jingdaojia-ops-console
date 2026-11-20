/**
 * 基础 UI 组件（无第三方 UI/图表依赖，SVG/CSS 手绘）。
 *
 * 导出：Card / StatTile / Table / FilterBar / Badge / StatusBadge /
 *       EmptyState / BarChart / SvgChart / Money
 */
import { fmtNumber, formatYuan, truncate } from '../lib/format.js'

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export function Card({ title, subtitle, actions, children, footer, className = '' }) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || subtitle || actions) && (
        <header className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
      {footer && <footer className="card-footer">{footer}</footer>}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* StatTile                                                                   */
/* -------------------------------------------------------------------------- */

export function StatTile({ label, value, hint, tone = 'neutral', className = '' }) {
  return (
    <div className={`stat-tile tone-${tone} ${className}`.trim()}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Badge / StatusBadge                                                       */
/* -------------------------------------------------------------------------- */

export function Badge({ tone = 'neutral', children, dot = false }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

const STATUS_LABELS = {
  // 工单
  created: '已创建',
  assigned: '已派单',
  checked_in: '已签到',
  completed: '已完成',
  closed: '已关闭',
  cancelled: '已取消',
  voided: '已作废',
  // 赔付
  draft: '草稿',
  pending_approval: '待审批',
  approved: '已审批',
  rejected: '已驳回',
  reversed: '已红冲',
  // 投诉
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  // 客户
  active: '活跃',
  churn_risk: '流失风险',
  churned: '已流失',
  // 其他
  locked: '已锁定',
  config_only: '未开城',
  inactive: '停用',
  undetermined: '待定',
  cleaner: '阿姨',
  customer: '客户',
  product: '产品',
  none: '无责',
}

const STATUS_TONES = {
  completed: 'success',
  closed: 'neutral',
  approved: 'success',
  resolved: 'success',
  active: 'success',
  locked: 'success',
  assigned: 'info',
  checked_in: 'info',
  processing: 'info',
  pending_approval: 'warning',
  churn_risk: 'warning',
  resumed: 'warning',
  undetermined: 'warning',
  created: 'neutral',
  draft: 'neutral',
  config_only: 'neutral',
  inactive: 'neutral',
  cancelled: 'danger',
  voided: 'danger',
  rejected: 'danger',
  churned: 'danger',
  open: 'danger',
}

export function StatusBadge({ status, label }) {
  return (
    <Badge tone={STATUS_TONES[status] || 'neutral'}>
      {label || STATUS_LABELS[status] || status || '—'}
    </Badge>
  )
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({ title = '暂无数据', hint, action, className = '' }) {
  return (
    <div className={`empty-state ${className}`.trim()} role="status">
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Table                                                                      */
/* -------------------------------------------------------------------------- */

export function Table({
  columns = [],
  rows = [],
  rowKey = 'id',
  empty = '暂无数据',
  emptyHint,
  dense = false,
  onRowClick,
  className = '',
  caption,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <EmptyState title={empty} hint={emptyHint} />
  }

  const keyOf = (row, index) => {
    if (typeof rowKey === 'function') return rowKey(row, index)
    return row?.[rowKey] ?? index
  }

  return (
    <div className={`table-wrap ${className}`.trim()}>
      <table className={`data-table${dense ? ' is-dense' : ''}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={col.align ? `align-${col.align}` : undefined}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={keyOf(row, index)}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              className={onRowClick ? 'is-clickable' : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[
                    col.align ? `align-${col.align}` : '',
                    col.className || '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.render ? col.render(row, index) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* FilterBar                                                                  */
/* -------------------------------------------------------------------------- */

export function FilterBar({ children, actions, className = '' }) {
  return (
    <div className={`filter-bar ${className}`.trim()}>
      <div className="filter-bar-fields">{children}</div>
      {actions && <div className="filter-bar-actions">{actions}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export function Money({ cents, showSign = false, symbol = '¥', className = '' }) {
  const n = Number(cents)
  const valid = Number.isFinite(n)
  return (
    <span
      className={`money${valid && n < 0 ? ' is-negative' : ''} ${className}`.trim()}
      title={valid ? formatYuan(n) : undefined}
    >
      {valid ? formatYuan(n, { showSign, symbol }) : '—'}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* BarChart / SvgChart                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 原生 SVG 柱状图。
 * - 空数组 → EmptyState 空态；
 * - 全 0 / 分母为 0 → 返回 null，不渲染 NaN；
 * - 支持正负值（损益场景），0 轴居中。
 */
export function BarChart({
  data = [],
  width = 680,
  height = 260,
  formatValue = (value) => String(value),
  showValues = true,
  emptyTitle = '暂无图表数据',
  emptyHint,
  ariaLabel = '柱状图',
  className = '',
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />
  }

  const points = data.map((item) => {
    const value = Number(item?.value)
    return {
      label: String(item?.label ?? ''),
      value: Number.isFinite(value) ? value : 0,
      color: item?.color,
    }
  })

  if (points.every((point) => point.value === 0)) return null

  const pad = { top: 22, right: 14, bottom: 46, left: 14 }
  const innerW = Math.max(1, width - pad.left - pad.right)
  const innerH = Math.max(1, height - pad.top - pad.bottom)
  const min = Math.min(0, ...points.map((point) => point.value))
  const max = Math.max(0, ...points.map((point) => point.value))
  const range = max - min || 1
  const yOf = (value) => pad.top + ((max - value) / range) * innerH
  const zeroY = yOf(0)
  const slot = innerW / points.length
  const barWidth = Math.max(4, Math.min(52, slot * 0.62))

  return (
    <div className={`bar-chart ${className}`.trim()}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={zeroY}
          y2={zeroY}
          className="bar-chart-baseline"
        />
        {points.map((point, index) => {
          const centerX = pad.left + slot * (index + 0.5)
          const top = yOf(Math.max(point.value, 0))
          const bottom = yOf(Math.min(point.value, 0))
          const barHeight = Math.max(point.value === 0 ? 0 : 1, bottom - top)
          const negative = point.value < 0
          return (
            <g key={`${point.label}-${index}`}>
              <rect
                x={centerX - barWidth / 2}
                y={top}
                width={barWidth}
                height={barHeight}
                rx={4}
                className={negative ? 'bar-chart-bar is-negative' : 'bar-chart-bar'}
                style={point.color ? { fill: point.color } : undefined}
              >
                <title>{`${point.label}: ${formatValue(point.value)}`}</title>
              </rect>
              {showValues && point.value !== 0 && (
                <text
                  x={centerX}
                  y={negative ? bottom + 13 : top - 6}
                  textAnchor="middle"
                  className="bar-chart-value"
                >
                  {formatValue(point.value)}
                </text>
              )}
              <text
                x={centerX}
                y={height - 16}
                textAnchor="middle"
                className="bar-chart-label"
              >
                {truncate(point.label, 8)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 兼容别名（docs components 中称 SvgChart）。 */
export const SvgChart = BarChart

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 列表分页条（受控）。页码从 1 开始。
 */
export function Pagination({ page = 1, pageSize = 20, total = 0, onChange, className = '' }) {
  const pages = Math.max(1, Math.ceil(Number(total) / Math.max(1, pageSize)))
  const current = Math.min(Math.max(1, Number(page) || 1), pages)
  return (
    <div className={`pagination ${className}`.trim()}>
      <span className="pagination-info">
        共 {fmtNumber(total)} 条 · 第 {current}/{pages} 页
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="btn"
          disabled={current <= 1}
          onClick={() => onChange && onChange(current - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="btn"
          disabled={current >= pages}
          onClick={() => onChange && onChange(current + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  )
}
