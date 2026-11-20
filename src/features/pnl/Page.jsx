import { useMemo, useState } from 'react'
import { useStore } from '../../store.js'
import {
  selectAllDistrictsPnl,
  selectDistrictPnl,
  selectDistrictTrend,
  selectLeakBreakdown,
  selectPnlTotals,
} from '../../store/selectors.js'
import { simulateLeakReduction } from '../../domain/pnl.js'
import {
  Badge,
  BarChart,
  Card,
  EmptyState,
  Money,
  StatTile,
  StatusBadge,
  Table,
} from '../../components/ui.jsx'
import { fmtPct, periodLabel } from '../../lib/format.js'

const XXT_ID = 'D-XXT'
const QX_ID = 'D-QX'
const WAN_CENTS = 1000000

/* -------------------------------------------------------------------------- */
/* 展示辅助（只做单位换算，损益数字一律来自 selector）                          */
/* -------------------------------------------------------------------------- */

function toWan(cents, digits = 2) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  return (n / WAN_CENTS).toFixed(digits)
}

function signedWan(cents, digits = 2) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  const body = (Math.abs(n) / WAN_CENTS).toFixed(digits)
  if (n < 0) return `−${body}`
  if (n > 0) return `+${body}`
  return body
}

function chartYuan(cents) {
  const n = Number(cents)
  return Number.isFinite(n) ? n / 100 : 0
}

function formatWanFromYuan(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${(n / 10000).toFixed(2)}万`
}

/* -------------------------------------------------------------------------- */
/* 损益瀑布（图形 + 数字）                                                     */
/* -------------------------------------------------------------------------- */

function Waterfall({ pnl }) {
  if (!pnl) return <EmptyState title="暂无损益数据" />
  if (!(Number(pnl.revenue) > 0)) {
    return (
      <EmptyState
        title="该片区暂无营收"
        hint="未开城（config_only）片区不产生营收、成本与漏损，无法拆解。"
      />
    )
  }

  const afterDirect = pnl.revenue - pnl.directCost
  const afterComp = afterDirect - pnl.compensation
  const afterRework = afterComp - pnl.reworkCost
  const afterIdle = afterRework - pnl.idleRunCost

  const steps = [
    {
      key: 'revenue',
      label: '营收',
      value: pnl.revenue,
      start: 0,
      end: pnl.revenue,
      kind: 'base',
      showSign: false,
    },
    {
      key: 'directCost',
      label: '直接成本',
      value: -pnl.directCost,
      start: pnl.revenue,
      end: afterDirect,
      kind: 'cost',
      showSign: true,
    },
    {
      key: 'gross',
      label: '毛利',
      value: pnl.grossProfit,
      start: 0,
      end: afterDirect,
      kind: 'subtotal',
      note: `毛利率 ${fmtPct(pnl.grossMarginPct)}`,
      showSign: true,
    },
    {
      key: 'compensation',
      label: '赔付',
      value: -pnl.compensation,
      start: afterDirect,
      end: afterComp,
      kind: 'leak',
      showSign: true,
    },
    {
      key: 'rework',
      label: '返工',
      value: -pnl.reworkCost,
      start: afterComp,
      end: afterRework,
      kind: 'leak',
      showSign: true,
    },
    {
      key: 'idle',
      label: '空跑',
      value: -pnl.idleRunCost,
      start: afterRework,
      end: afterIdle,
      kind: 'leak',
      showSign: true,
    },
    {
      key: 'leakTotal',
      label: '漏损合计',
      value: -pnl.leakTotal,
      start: afterDirect,
      end: afterIdle,
      kind: 'leak-total',
      note: `占营收 ${fmtPct(pnl.leakPct)}`,
      showSign: true,
    },
    {
      key: 'fixedCost',
      label: '固定成本',
      value: -pnl.fixedCost,
      start: afterIdle,
      end: pnl.netProfit,
      kind: 'cost',
      showSign: true,
    },
    {
      key: 'net',
      label: '净利',
      value: pnl.netProfit,
      start: 0,
      end: pnl.netProfit,
      kind: pnl.netProfit < 0 ? 'net-negative' : 'net-positive',
      note: `净利率 ${fmtPct(pnl.netMarginPct)}`,
      showSign: true,
    },
  ]

  const coords = [0, pnl.revenue]
  for (const step of steps) {
    coords.push(step.start, step.end)
  }
  const domainMin = Math.min(...coords)
  const domainMax = Math.max(...coords, pnl.revenue, 1)
  const range = domainMax - domainMin || 1
  const zeroPct = ((0 - domainMin) / range) * 100

  return (
    <div className="pnl-waterfall" role="group" aria-label="损益瀑布拆解">
      {steps.map((step) => {
        const left = ((Math.min(step.start, step.end) - domainMin) / range) * 100
        const width = (Math.abs(step.end - step.start) / range) * 100
        return (
          <div key={step.key} className={`pnl-wf-row is-${step.kind}`}>
            <span className="pnl-wf-label">{step.label}</span>
            <span className="pnl-wf-track" aria-hidden="true">
              <span className="pnl-wf-zero" style={{ left: `${zeroPct}%` }} />
              <span
                className={`pnl-wf-bar is-${step.kind}`}
                style={{
                  left: `${left}%`,
                  width: `${step.value === 0 ? 0 : Math.max(width, 0.6)}%`,
                }}
              />
            </span>
            <span className="pnl-wf-value">
              <Money cents={step.value} showSign={step.showSign} />
              {step.note && <em className="pnl-wf-note">{step.note}</em>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 对照片区精简损益                                                            */
/* -------------------------------------------------------------------------- */

function PnlMini({ pnl }) {
  if (!pnl) return <EmptyState title="暂无对照数据" />
  const rows = [
    { label: '营收', value: pnl.revenue, showSign: false },
    { label: '直接成本', value: -pnl.directCost, showSign: true },
    {
      label: '毛利',
      value: pnl.grossProfit,
      note: `毛利率 ${fmtPct(pnl.grossMarginPct)}`,
      showSign: true,
    },
    {
      label: '漏损合计',
      value: -pnl.leakTotal,
      note: pnl.leakTotal === 0 ? '无漏损' : `占营收 ${fmtPct(pnl.leakPct)}`,
      showSign: true,
    },
    { label: '固定成本', value: -pnl.fixedCost, showSign: true },
    {
      label: '净利',
      value: pnl.netProfit,
      note: `净利率 ${fmtPct(pnl.netMarginPct)}`,
      showSign: true,
      strong: true,
    },
  ]

  return (
    <dl className="pnl-mini">
      {rows.map((row) => (
        <div key={row.label} className={`pnl-mini-row${row.strong ? ' is-strong' : ''}`}>
          <dt>{row.label}</dt>
          <dd>
            <Money cents={row.value} showSign={row.showSign} />
            {row.note && <em>{row.note}</em>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* -------------------------------------------------------------------------- */
/* 瀑布式文字拆解行                                                            */
/* -------------------------------------------------------------------------- */

function WaterfallText({ pnl }) {
  if (!pnl) return <EmptyState title="暂无拆解数据" />
  const steps = [
    { key: 'revenue', label: '营收', value: pnl.revenue, showSign: false },
    { key: 'direct', label: '直接成本', value: -pnl.directCost, showSign: true },
    {
      key: 'gross',
      label: '毛利',
      value: pnl.grossProfit,
      note: fmtPct(pnl.grossMarginPct),
      showSign: true,
    },
    { key: 'comp', label: '赔付', value: -pnl.compensation, showSign: true },
    { key: 'rework', label: '返工', value: -pnl.reworkCost, showSign: true },
    { key: 'idle', label: '空跑', value: -pnl.idleRunCost, showSign: true },
    {
      key: 'leak',
      label: '漏损合计',
      value: -pnl.leakTotal,
      note: fmtPct(pnl.leakPct),
      showSign: true,
    },
    { key: 'fixed', label: '固定成本', value: -pnl.fixedCost, showSign: true },
    {
      key: 'net',
      label: '净利',
      value: pnl.netProfit,
      note: fmtPct(pnl.netMarginPct),
      showSign: true,
    },
  ]

  return (
    <div className="pnl-wf-text" aria-label="瀑布式文字拆解">
      {steps.map((step, index) => (
        <span key={step.key} className="pnl-wf-text-item">
          <span className="pnl-wf-text-label">{step.label}</span>
          <Money cents={step.value} showSign={step.showSign} />
          {step.note && <em>{step.note}</em>}
          {index < steps.length - 1 && (
            <span className="pnl-arrow" aria-hidden="true">
              →
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 滑杆                                                                        */
/* -------------------------------------------------------------------------- */

function DropSlider({ id, label, value, onChange }) {
  return (
    <div className="pnl-slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min="0"
        max="60"
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="pnl-slider-value">{value}%</span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* M5 片区损益                                                                 */
/* -------------------------------------------------------------------------- */

export default function PnlPage() {
  const state = useStore((s) => s)
  const period = state.meta?.period || '2026-10'

  const [showConfigOnly, setShowConfigOnly] = useState(false)
  const [selectedDistrictId, setSelectedDistrictId] = useState(XXT_ID)
  const [compDrop, setCompDrop] = useState(30)
  const [reworkDrop, setReworkDrop] = useState(25)
  const [idleDrop, setIdleDrop] = useState(40)

  const districts = state.districts || []

  const allPnl = useMemo(() => selectAllDistrictsPnl(state, period), [state, period])
  const totals = useMemo(() => selectPnlTotals(state, period), [state, period])
  const xxtPnl = useMemo(() => selectDistrictPnl(state, XXT_ID, period), [state, period])
  const qxPnl = useMemo(() => selectDistrictPnl(state, QX_ID, period), [state, period])
  const selectedPnl = useMemo(
    () => selectDistrictPnl(state, selectedDistrictId, period),
    [state, selectedDistrictId, period],
  )
  const leakRows = useMemo(
    () => selectLeakBreakdown(state, selectedDistrictId, period),
    [state, selectedDistrictId, period],
  )
  const selectedTrend = useMemo(
    () => selectDistrictTrend(state, selectedDistrictId),
    [state, selectedDistrictId],
  )
  const xxtTrend = useMemo(() => selectDistrictTrend(state, XXT_ID), [state])

  const xxtDistrict = districts.find((d) => d.id === XXT_ID)
  const qxDistrict = districts.find((d) => d.id === QX_ID)
  const selectedDistrict = districts.find((d) => d.id === selectedDistrictId)
  const xxtName = xxtDistrict?.name || '西乡塘'
  const qxName = qxDistrict?.name || '青秀'

  const visibleRows = showConfigOnly
    ? allPnl
    : allPnl.filter((row) => row.district.status !== 'config_only')
  const rankingData = visibleRows.map((row) => ({
    label: row.district.name,
    value: chartYuan(row.pnl.netProfit),
  }))

  const pilotRows = allPnl.filter((row) => row.district.is_pilot)
  const pilotsBalanced =
    pilotRows.length > 0 && pilotRows.every((row) => row.pnl.balanced)

  const trendData = selectedTrend.map((row) => ({
    label: row.period.slice(2),
    value: chartYuan(row.net_profit),
  }))
  const trendHasData = selectedTrend.some(
    (row) => Number(row.net_profit) !== 0 || Number(row.revenue) !== 0,
  )
  const negativeStreak = useMemo(() => {
    let streak = 0
    for (let i = selectedTrend.length - 1; i >= 0; i -= 1) {
      const value = Number(selectedTrend[i].net_profit)
      if (Number.isFinite(value) && value < 0) streak += 1
      else break
    }
    return streak
  }, [selectedTrend])
  const trendFirst = selectedTrend[0]?.period || '—'
  const trendLast = selectedTrend[selectedTrend.length - 1]?.period || '—'
  const xxtTrendFirst = xxtTrend[0]?.period || '—'
  const xxtTrendLast = xxtTrend[xxtTrend.length - 1]?.period || '—'

  const leakChartData = leakRows.map((item) => ({
    label: item.label,
    value: chartYuan(item.amount),
  }))

  const sim = useMemo(() => {
    if (!xxtPnl) return null
    try {
      return simulateLeakReduction(xxtPnl, {
        compensationDrop: compDrop / 100,
        reworkDrop: reworkDrop / 100,
        idleDrop: idleDrop / 100,
      })
    } catch {
      return null
    }
  }, [xxtPnl, compDrop, reworkDrop, idleDrop])

  const simImprovement = sim && xxtPnl ? sim.netProfit - xxtPnl.netProfit : null
  const grossAfterLeak = xxtPnl ? xxtPnl.grossProfit - xxtPnl.fixedCost : 0

  const tableColumns = [
    {
      key: 'district',
      title: '片区',
      render: (row) => (
        <span className="pnl-district-cell">
          <b>{row.district.name}</b>
          <em>{row.district.manager}</em>
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      align: 'center',
      render: (row) => (
        <StatusBadge
          status={row.district.status}
          label={row.district.status === 'config_only' ? '未开城' : 'active'}
        />
      ),
    },
    {
      key: 'revenue',
      title: '营收',
      align: 'right',
      render: (row) => <Money cents={row.pnl.revenue} />,
    },
    {
      key: 'directCost',
      title: '直接成本',
      align: 'right',
      render: (row) => <Money cents={row.pnl.directCost} />,
    },
    {
      key: 'grossProfit',
      title: '毛利',
      align: 'right',
      render: (row) => <Money cents={row.pnl.grossProfit} />,
    },
    {
      key: 'grossMarginPct',
      title: '毛利率',
      align: 'right',
      render: (row) => fmtPct(row.pnl.grossMarginPct),
    },
    {
      key: 'compensation',
      title: '赔付',
      align: 'right',
      render: (row) => <Money cents={row.pnl.compensation} />,
    },
    {
      key: 'reworkCost',
      title: '返工',
      align: 'right',
      render: (row) => <Money cents={row.pnl.reworkCost} />,
    },
    {
      key: 'idleRunCost',
      title: '空跑',
      align: 'right',
      render: (row) => <Money cents={row.pnl.idleRunCost} />,
    },
    {
      key: 'leakTotal',
      title: '漏损',
      align: 'right',
      render: (row) => <Money cents={row.pnl.leakTotal} />,
    },
    {
      key: 'fixedCost',
      title: '固定成本',
      align: 'right',
      render: (row) => <Money cents={row.pnl.fixedCost} />,
    },
    {
      key: 'netProfit',
      title: '净利',
      align: 'right',
      render: (row) => <Money cents={row.pnl.netProfit} showSign />,
    },
    {
      key: 'netMarginPct',
      title: '净利率',
      align: 'right',
      render: (row) => fmtPct(row.pnl.netMarginPct),
    },
    {
      key: 'balanced',
      title: '平衡校验',
      align: 'center',
      render: (row) =>
        row.pnl.balanced ? (
          <Badge tone="success">闭合</Badge>
        ) : (
          <Badge tone="danger">差异</Badge>
        ),
    },
  ]

  return (
    <section className="page">
      <style>{`
        .pnl-conclusion {
          border: 1px solid rgba(220, 38, 38, 0.26);
          box-shadow: 0 14px 34px rgba(220, 38, 38, 0.1);
        }
        .pnl-conclusion > .card-header {
          background: linear-gradient(135deg, #fff5f5 0%, #ffffff 62%);
        }
        .pnl-conclusion .card-title {
          font-size: 19px;
          letter-spacing: 0.01em;
        }
        .pnl-conclusion-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.65fr) minmax(260px, 1fr);
          gap: 22px;
          align-items: start;
        }
        .pnl-verdict {
          padding: 14px 16px;
          border: 1px solid rgba(220, 38, 38, 0.2);
          border-radius: var(--radius);
          background: var(--danger-soft);
          margin-bottom: 16px;
        }
        .pnl-verdict-kicker {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--danger);
          margin-bottom: 6px;
        }
        .pnl-sentence {
          margin: 0;
          font-size: 15px;
          line-height: 1.85;
          color: var(--text);
        }
        .pnl-sentence b {
          color: var(--danger);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .pnl-sentence b.is-positive {
          color: var(--success);
        }
        .pnl-verdict-foot {
          margin: 8px 0 0;
          font-size: 12px;
          color: var(--text-2);
        }
        .pnl-waterfall {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .pnl-wf-row {
          display: grid;
          grid-template-columns: 86px minmax(120px, 1fr) 176px;
          gap: 10px;
          align-items: center;
          padding: 4px 6px;
          border-radius: var(--radius-sm);
        }
        .pnl-wf-row.is-subtotal,
        .pnl-wf-row.is-leak-total,
        .pnl-wf-row.is-net-negative,
        .pnl-wf-row.is-net-positive {
          background: var(--surface-2);
        }
        .pnl-wf-row.is-net-negative,
        .pnl-wf-row.is-net-positive {
          background: var(--surface-3);
          box-shadow: inset 0 0 0 1px var(--border);
        }
        .pnl-wf-row.is-subtotal .pnl-wf-label,
        .pnl-wf-row.is-leak-total .pnl-wf-label,
        .pnl-wf-row.is-net-negative .pnl-wf-label,
        .pnl-wf-row.is-net-positive .pnl-wf-label {
          color: var(--text);
          font-weight: 600;
        }
        .pnl-wf-label {
          font-size: 12px;
          color: var(--muted);
          text-align: right;
          white-space: nowrap;
        }
        .pnl-wf-track {
          position: relative;
          height: 17px;
          border-radius: 999px;
          background: var(--surface-3);
          overflow: hidden;
        }
        .pnl-wf-zero {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--border-strong);
        }
        .pnl-wf-bar {
          position: absolute;
          top: 3px;
          bottom: 3px;
          border-radius: 4px;
          background: var(--accent);
        }
        .pnl-wf-bar.is-cost {
          background: #f59e0b;
        }
        .pnl-wf-bar.is-subtotal {
          background: var(--info);
        }
        .pnl-wf-bar.is-leak {
          background: var(--danger);
          opacity: 0.82;
        }
        .pnl-wf-bar.is-leak-total {
          background: #b91c1c;
        }
        .pnl-wf-bar.is-net-negative {
          background: var(--danger);
        }
        .pnl-wf-bar.is-net-positive {
          background: var(--success);
        }
        .pnl-wf-value {
          display: flex;
          align-items: baseline;
          justify-content: flex-end;
          gap: 7px;
          flex-wrap: wrap;
          font-size: 12.5px;
        }
        .pnl-wf-note {
          color: var(--muted);
          font-size: 11px;
          font-style: normal;
          white-space: nowrap;
        }
        .pnl-compare {
          padding: 15px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface-2);
        }
        .pnl-compare-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }
        .pnl-compare-head h3 {
          margin: 0;
          font-size: 14px;
        }
        .pnl-compare-note {
          margin: 0 0 12px;
          font-size: 11.5px;
          line-height: 1.7;
          color: var(--muted);
        }
        .pnl-mini {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pnl-mini-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          padding: 5px 2px;
          border-bottom: 1px dashed var(--border);
        }
        .pnl-mini-row:last-child {
          border-bottom: 0;
        }
        .pnl-mini-row dt {
          font-size: 12px;
          color: var(--muted);
          white-space: nowrap;
        }
        .pnl-mini-row dd {
          margin: 0;
          display: flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
          font-size: 12.5px;
          font-variant-numeric: tabular-nums;
        }
        .pnl-mini-row dd em {
          font-size: 11px;
          font-style: normal;
          color: var(--muted);
        }
        .pnl-mini-row.is-strong {
          padding-top: 8px;
          margin-top: 2px;
          border-top: 1px solid var(--border);
          border-bottom: 0;
        }
        .pnl-mini-row.is-strong dt,
        .pnl-mini-row.is-strong dd {
          font-weight: 700;
          color: var(--text);
          font-size: 13px;
        }
        .pnl-check {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-2);
          cursor: pointer;
          white-space: nowrap;
        }
        .pnl-check input {
          accent-color: var(--accent);
        }
        .pnl-chart-note {
          margin: 10px 0 0;
          font-size: 11.5px;
          line-height: 1.7;
          color: var(--muted);
        }
        .pnl-district-cell {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          white-space: nowrap;
        }
        .pnl-district-cell em {
          font-style: normal;
          font-size: 11px;
          color: var(--muted);
        }
        .pnl-table-note {
          margin: 0 0 10px;
          font-size: 12px;
          color: var(--muted);
        }
        .pnl-drill-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .pnl-drill-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 12px;
          color: var(--muted);
        }
        .pnl-leak-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }
        .pnl-leak-item {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 11px 13px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface);
        }
        .pnl-leak-item.is-total {
          border-color: rgba(220, 38, 38, 0.28);
          background: var(--danger-soft);
        }
        .pnl-leak-label {
          font-size: 12px;
          color: var(--muted);
        }
        .pnl-leak-value {
          font-size: 17px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pnl-leak-share {
          font-size: 11px;
          color: var(--muted);
        }
        .pnl-wf-text {
          display: flex;
          align-items: center;
          gap: 5px 7px;
          flex-wrap: wrap;
          margin-top: 14px;
          padding: 10px 12px;
          border: 1px dashed var(--border-strong);
          border-radius: var(--radius);
          background: var(--surface-2);
          font-size: 12px;
          line-height: 1.8;
        }
        .pnl-wf-text-item {
          display: inline-flex;
          align-items: baseline;
          gap: 5px;
        }
        .pnl-wf-text-label {
          color: var(--muted);
        }
        .pnl-wf-text-item em {
          font-style: normal;
          font-size: 10.5px;
          color: var(--muted);
        }
        .pnl-arrow {
          margin-left: 3px;
          color: var(--border-strong);
        }
        .pnl-trend-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 10px;
          font-size: 11.5px;
          line-height: 1.7;
          color: var(--muted);
        }
        .pnl-sim-note {
          margin-bottom: 14px;
          padding: 10px 14px;
          border: 1px dashed #f59e0b;
          border-radius: var(--radius-sm);
          background: var(--warning-soft);
          color: var(--warning);
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .pnl-sim-grid {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) minmax(300px, 1.3fr);
          gap: 22px;
          align-items: start;
        }
        .pnl-sliders {
          padding: 14px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface-2);
        }
        .pnl-slider {
          display: grid;
          grid-template-columns: 96px minmax(100px, 1fr) 46px;
          gap: 10px;
          align-items: center;
          margin-bottom: 14px;
        }
        .pnl-slider:last-child {
          margin-bottom: 0;
        }
        .pnl-slider label {
          font-size: 12.5px;
          color: var(--text-2);
        }
        .pnl-slider input[type="range"] {
          width: 100%;
          accent-color: var(--accent);
        }
        .pnl-slider-value {
          text-align: right;
          font-size: 12.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--accent-strong);
        }
        .pnl-sim-results {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
        }
        .pnl-sim-detail {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px dashed var(--border);
          font-size: 12px;
          line-height: 1.9;
          color: var(--text-2);
        }
        .pnl-foot p {
          margin: 0 0 8px;
          font-size: 12.5px;
          line-height: 1.85;
          color: var(--text-2);
        }
        .pnl-foot p:last-child {
          margin-bottom: 0;
        }
        .pnl-foot b {
          color: var(--text);
        }
        @media (max-width: 900px) {
          .pnl-conclusion-grid,
          .pnl-sim-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .pnl-wf-row {
            grid-template-columns: 68px minmax(80px, 1fr) 140px;
          }
          .pnl-wf-value {
            font-size: 11.5px;
          }
          .pnl-wf-note {
            display: none;
          }
          .pnl-slider {
            grid-template-columns: 82px minmax(90px, 1fr) 42px;
          }
        }
      `}</style>

      <header className="page-head">
        <div>
          <span className="page-code">M5</span>
          <h1>片区损益</h1>
          <p className="muted">
            {periodLabel(period)} · 8 片区净利排行、损益科目下钻、14 个月趋势与堵漏模拟
          </p>
        </div>
        <Badge tone="accent">{period}</Badge>
      </header>

      {/* 1. 结论卡 ---------------------------------------------------------- */}
      <Card
        className="pnl-conclusion"
        title={`${xxtName}到底亏在哪`}
        subtitle={`${periodLabel(period)} · 管理口径：营收 − 直接成本 − 赔付 − 返工 − 空跑 − 固定成本 = 净利`}
        actions={
          xxtPnl ? (
            <Badge tone={xxtPnl.netProfit < 0 ? 'danger' : 'success'} dot>
              {xxtPnl.netProfit < 0 ? '亏损片区' : '盈利片区'}
            </Badge>
          ) : null
        }
      >
        {xxtPnl ? (
          <div className="pnl-conclusion-grid">
            <div>
              <div className="pnl-verdict">
                <div className="pnl-verdict-kicker">一句话结论</div>
                <p className="pnl-sentence">
                  {xxtName}亏在漏损 <b>{toWan(xxtPnl.leakTotal)} 万/月</b>：赔付{' '}
                  <b>{toWan(xxtPnl.compensation)}</b> + 返工{' '}
                  <b>{toWan(xxtPnl.reworkCost)}</b> + 空跑{' '}
                  <b>{toWan(xxtPnl.idleRunCost)}</b>；剔除漏损后为{' '}
                  <b className={grossAfterLeak >= 0 ? 'is-positive' : undefined}>
                    {signedWan(grossAfterLeak)} 万/月
                  </b>
                  ，说明问题不是毛利不够，而是漏损吃掉利润。
                </p>
                <p className="pnl-verdict-foot">
                  当前净利 <Money cents={xxtPnl.netProfit} showSign />
                  （净利率 {fmtPct(xxtPnl.netMarginPct)}），漏损占营收{' '}
                  {fmtPct(xxtPnl.leakPct)}。
                </p>
              </div>
              <Waterfall pnl={xxtPnl} />
            </div>

            <aside className="pnl-compare" aria-label={`${qxName}对照`}>
              <div className="pnl-compare-head">
                <h3>{qxName}对照</h3>
                <Badge tone={qxPnl && qxPnl.netProfit >= 0 ? 'success' : 'neutral'}>
                  {qxPnl && qxPnl.netProfit >= 0 ? '盈利' : '亏损'}
                </Badge>
              </div>
              <p className="pnl-compare-note">
                {qxName}为「无漏损样本 / 参照」（虚构设定），用于验证损益口径；其漏损合计{' '}
                {qxPnl ? toWan(qxPnl.leakTotal) : '—'} 万。
              </p>
              <PnlMini pnl={qxPnl} />
            </aside>
          </div>
        ) : (
          <EmptyState
            title="暂无片区损益"
            hint="种子数据尚未加载，或当前账期没有可归集的片区。"
          />
        )}
      </Card>

      {/* 2. KPI ------------------------------------------------------------- */}
      <div className="stat-grid" aria-label="片区损益 KPI">
        <StatTile
          label="两片区合计营收"
          value={<Money cents={totals.revenue} />}
          hint={`账期 ${period}；未开城片区为 0`}
        />
        <StatTile
          label="两片区合计净利"
          value={<Money cents={totals.netProfit} showSign />}
          tone={totals.netProfit < 0 ? 'danger' : 'success'}
          hint={`合计净利率 ${fmtPct(totals.netMarginPct)}`}
        />
        <StatTile
          label={`${xxtName}净利`}
          value={<Money cents={xxtPnl?.netProfit} showSign />}
          tone="danger"
          hint={`净利率 ${fmtPct(xxtPnl?.netMarginPct)}`}
        />
        <StatTile
          label={`${qxName}净利`}
          value={<Money cents={qxPnl?.netProfit} showSign />}
          tone="success"
          hint={`净利率 ${fmtPct(qxPnl?.netMarginPct)}`}
        />
        <StatTile
          label="漏损合计"
          value={<Money cents={totals.leakTotal} />}
          tone="warning"
          hint={`赔付 + 返工 + 空跑 · 占合计营收 ${fmtPct(totals.leakPct)}`}
        />
      </div>

      {/* 3. 净利排行 -------------------------------------------------------- */}
      <Card
        title="片区净利排行"
        subtitle="按净利降序；柱值为净利（元），标注单位为万元"
        actions={
          <label className="pnl-check">
            <input
              type="checkbox"
              checked={showConfigOnly}
              onChange={(event) => setShowConfigOnly(event.target.checked)}
            />
            显示未开城片区
          </label>
        }
      >
        {rankingData.length > 0 ? (
          <BarChart
            data={rankingData}
            width={760}
            height={280}
            formatValue={formatWanFromYuan}
            ariaLabel="片区净利排行柱状图"
          />
        ) : (
          <EmptyState
            title="暂无可排行的片区"
            hint="勾选「显示未开城片区」可查看全部 8 个片区的净利（未开城为 0）。"
          />
        )}
        <p className="pnl-chart-note">
          默认隐藏 6 个未开城（config_only）片区；红色柱为净利为负。当前显示{' '}
          {visibleRows.length} / {allPnl.length} 个片区。
        </p>
      </Card>

      {/* 4. 损益总表 -------------------------------------------------------- */}
      <Card
        title="片区损益总表"
        subtitle={`${periodLabel(period)} · 全量 8 片区；点击任一行切换下方下钻片区`}
        footer="平衡校验：分项复算与净利差异 ≤ 1 分显示「闭合」，否则显示「差异」。"
      >
        <Table
          columns={tableColumns}
          rows={allPnl}
          rowKey={(row) => row.district.id}
          onRowClick={(row) => setSelectedDistrictId(row.district.id)}
          dense
          empty="暂无片区损益"
          emptyHint="请确认种子数据与账期。"
          caption="片区损益总表"
        />
      </Card>

      {/* 5. 片区下钻 -------------------------------------------------------- */}
      <Card
        title="片区损益下钻"
        subtitle="三项漏损金额、占营收比例与瀑布式文字拆解"
      >
        <div className="pnl-drill-head">
          <label className="field">
            选择片区
            <select
              value={selectedDistrictId}
              onChange={(event) => setSelectedDistrictId(event.target.value)}
            >
              {districts.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name}
                  {district.status === 'config_only' ? '（未开城）' : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedPnl && (
            <div className="pnl-drill-meta">
              <span>{selectedDistrict?.name || '—'}</span>
              <span>营收 <Money cents={selectedPnl.revenue} /></span>
              <Badge tone={selectedPnl.balanced ? 'success' : 'danger'}>
                {selectedPnl.balanced ? '平衡校验闭合' : '平衡校验差异'}
              </Badge>
            </div>
          )}
        </div>

        {selectedPnl && selectedPnl.revenue > 0 ? (
          <>
            <div className="pnl-leak-grid">
              {leakRows.map((item) => (
                <div key={item.key} className="pnl-leak-item">
                  <span className="pnl-leak-label">{item.label}</span>
                  <span className="pnl-leak-value">
                    <Money cents={item.amount} />
                  </span>
                  <span className="pnl-leak-share">
                    占营收 {fmtPct(item.sharePct)}
                  </span>
                </div>
              ))}
              <div className="pnl-leak-item is-total">
                <span className="pnl-leak-label">漏损合计</span>
                <span className="pnl-leak-value">
                  <Money cents={selectedPnl.leakTotal} />
                </span>
                <span className="pnl-leak-share">
                  占营收 {fmtPct(selectedPnl.leakPct)}
                </span>
              </div>
            </div>

            <BarChart
              data={leakChartData}
              width={620}
              height={220}
              formatValue={formatWanFromYuan}
              ariaLabel={`${selectedDistrict?.name || '片区'}三项漏损柱状图`}
            />

            <WaterfallText pnl={selectedPnl} />
          </>
        ) : (
          <EmptyState
            title="该片区暂无经营明细"
            hint="未开城（config_only）片区不产生营收、成本与漏损；请选择已开城片区或切换账期。"
          />
        )}
      </Card>

      {/* 6. 14 个月趋势 ----------------------------------------------------- */}
      <Card
        title={`${selectedDistrict?.name || '片区'} · 净利趋势`}
        subtitle={`数据来自 monthly_summary 快照 · ${selectedTrend.length} 期（${trendFirst} … ${trendLast}）`}
        actions={
          <Badge tone={negativeStreak > 0 ? 'danger' : 'success'}>
            连续为负 {negativeStreak} 个月
          </Badge>
        }
      >
        {selectedTrend.length === 0 ? (
          <EmptyState title="暂无月度快照" hint="monthly_summary 中没有该片区的账期数据。" />
        ) : trendHasData ? (
          <BarChart
            data={trendData}
            width={760}
            height={280}
            formatValue={formatWanFromYuan}
            ariaLabel={`${selectedDistrict?.name || '片区'}近 ${selectedTrend.length} 个月净利柱状图`}
          />
        ) : (
          <EmptyState
            title="该片区暂无经营快照"
            hint="未开城片区的 monthly_summary 记录均为 0，暂不绘制趋势。"
          />
        )}
        <div className="pnl-trend-foot">
          <span>
            标签为 YY-MM；净利为负显示红色柱。共 {selectedTrend.length} 期，最近连续为负{' '}
            {negativeStreak} 期。
          </span>
          <span>
            {xxtName}快照覆盖 {xxtTrendFirst} … {xxtTrendLast}（{xxtTrend.length} 期）。
          </span>
        </div>
      </Card>

      {/* 7. 堵漏模拟 -------------------------------------------------------- */}
      <Card
        title={`堵漏模拟 · ${xxtName}`}
        subtitle="调整三项漏损的下降比例，实时测算对净利的影响"
        actions={<Badge tone="warning">假设测算</Badge>}
      >
        <div className="pnl-sim-note" role="note">
          假设测算 · 不写入账 · 仅用于整改 / 定价决策（不改变上方真实损益）
        </div>

        {sim && xxtPnl ? (
          <div className="pnl-sim-grid">
            <div className="pnl-sliders">
              <DropSlider
                id="pnl-sim-comp"
                label="赔付下降"
                value={compDrop}
                onChange={setCompDrop}
              />
              <DropSlider
                id="pnl-sim-rework"
                label="返工下降"
                value={reworkDrop}
                onChange={setReworkDrop}
              />
              <DropSlider
                id="pnl-sim-idle"
                label="空跑下降"
                value={idleDrop}
                onChange={setIdleDrop}
              />
            </div>

            <div>
              <div className="pnl-sim-results">
                <StatTile
                  label="新漏损合计"
                  value={<Money cents={sim.leakTotal} />}
                  tone="warning"
                  hint={`原 ${toWan(xxtPnl.leakTotal, 3)} 万`}
                />
                <StatTile
                  label="新净利"
                  value={<Money cents={sim.netProfit} showSign />}
                  tone={sim.netProfit < 0 ? 'danger' : 'success'}
                  hint={`净利率 ${fmtPct(sim.netMarginPct)}`}
                />
                <StatTile
                  label="改善额"
                  value={<Money cents={simImprovement} showSign />}
                  tone="success"
                  hint={`漏损减少 ${toWan(simImprovement, 3)} 万`}
                />
                <StatTile
                  label="模拟结论"
                  value={
                    <Badge tone={sim.netProfit < 0 ? 'danger' : 'success'} dot>
                      {sim.netProfit < 0 ? '仍为负' : '已转正'}
                    </Badge>
                  }
                  tone={sim.netProfit < 0 ? 'danger' : 'success'}
                  hint={`净利率 ${fmtPct(sim.netMarginPct)}`}
                />
              </div>
              <div className="pnl-sim-detail">
                赔付 <Money cents={sim.compensation} />（降{' '}
                {Math.round((sim.scenario?.compensationDrop || 0) * 100)}%）· 返工{' '}
                <Money cents={sim.reworkCost} />（降{' '}
                {Math.round((sim.scenario?.reworkDrop || 0) * 100)}%）· 空跑{' '}
                <Money cents={sim.idleRunCost} />（降{' '}
                {Math.round((sim.scenario?.idleDrop || 0) * 100)}%）；漏损合计由{' '}
                <Money cents={xxtPnl.leakTotal} /> 降至 <Money cents={sim.leakTotal} />。
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title="暂无可模拟的损益"
            hint="需要先有西乡塘片区的有效损益（营收 > 0）。"
          />
        )}
      </Card>

      {/* 8. 口径说明 -------------------------------------------------------- */}
      <Card title="对账与口径说明" className="pnl-foot">
        <p>
          <b>口径：</b>营收 − 直接成本 − 赔付 − 返工 − 空跑 − 固定成本 = 净利；其中营收 −
          直接成本 = 干净毛利，漏损 = 赔付 + 返工 + 空跑。财务报表中的「毛利」已扣三项漏损，
          故本页统一以「直接成本」作为扣除项，避免重复扣减。
        </p>
        <p>
          <b>金额与比率：</b>全部金额以「分」计算、按「元」展示；百分比由分项金额派生，
          分母为 0 时显示「—」，不产生 NaN。
        </p>
        <p>
          <b>平衡校验：</b>两片区（pilot）balanced{' '}
          {pilotsBalanced ? '均为 true' : '存在差异'}（差异 ≤ 1 分视为闭合）；总表逐行显示
          「闭合 / 差异」。
        </p>
        <p>
          <b>数据来源：</b>片区损益由明细台账按账期实时派生；14 个月趋势来自
          monthly_summary 快照（{xxtTrendFirst} … {xxtTrendLast}），不随明细重算。
        </p>
      </Card>
    </section>
  )
}
