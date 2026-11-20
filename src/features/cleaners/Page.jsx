import { useMemo, useState } from 'react'
import { useStore } from '../../store.js'
import {
  Card,
  StatTile,
  Table,
  FilterBar,
  Badge,
  EmptyState,
  Money,
  Pagination,
} from '../../components/ui.jsx'
import {
  selectPayroll,
  selectCleanerCommission,
} from '../../store/selectors.js'
import { setQualityOverride } from '../../store/actions.js'
import { calcCommission } from '../../domain/commission.js'
import { periodOf } from '../../domain/period.js'
import { fmtNumber, fmtDateTime, formatYuan, toPct } from '../../lib/format.js'
import { toCsv, downloadCsv, csvMoney } from '../../lib/csv.js'

const REVENUE_STATUS = new Set(['completed', 'closed'])
const FIFTEEN_MIN_MS = 15 * 60 * 1000
const PAGE_SIZE = 20
const PAGE_CODE = 'M3'

/** 质量系数来源徽标（computed 兼容 domain 的 calculated 命名）。 */
const SOURCE_META = {
  calculated: { label: '自动', tone: 'info', cn: '自动计算' },
  computed: { label: '自动', tone: 'info', cn: '自动计算' },
  override: { label: '人工', tone: 'warning', cn: '人工覆盖' },
  default: { label: '默认', tone: 'neutral', cn: '默认值' },
}

/** 验收算例（docs §3.2）：120 分钟、25 元/时、订单 150 元、15%、系数 1.05。 */
const SAMPLE = calcCommission({
  orderId: 'SAMPLE',
  cleanerId: 'SAMPLE',
  amount: 15000,
  checkinAt: '2026-10-01T09:00:00+08:00',
  completedAt: '2026-10-01T11:00:00+08:00',
  hourlyRate: 2500,
  baseRate: 0.15,
  qualityCoef: 1.05,
  isRework: false,
})

function sourceMeta(source) {
  return SOURCE_META[source] || { label: source || '—', tone: 'neutral', cn: source || '—' }
}

function pctOf(count, total) {
  return total > 0 ? toPct(count / total) : '—'
}

/**
 * 与 selectCleanerQuality 同口径统计分子/分母，仅用于展示，不参与金额计算。
 */
function qualityParts(state, cleanerId, period) {
  const orders = (state.orders || []).filter(
    (order) =>
      order.cleaner_id === cleanerId &&
      REVENUE_STATUS.has(order.status) &&
      periodOf(order.completed_at) === period,
  )
  const orderIds = new Set(orders.map((order) => order.id))
  const onTime = orders.filter((order) => {
    const scheduled = Date.parse(order.scheduled_at)
    const checkin = Date.parse(order.checkin_at)
    if (!Number.isFinite(scheduled) || !Number.isFinite(checkin)) return false
    return Math.abs(checkin - scheduled) <= FIFTEEN_MIN_MS
  }).length
  const complaints = (state.complaints || []).filter(
    (complaint) =>
      orderIds.has(complaint.order_id) &&
      periodOf(complaint.created_at) === period,
  ).length
  const orderById = new Map((state.orders || []).map((order) => [order.id, order]))
  const reworks = (state.reworks || []).filter((record) => {
    const original = orderById.get(record.order_id)
    return (
      original &&
      original.cleaner_id === cleanerId &&
      periodOf(record.created_at) === period
    )
  }).length
  return { orders: orders.length, onTime, complaints, reworks }
}

/* -------------------------------------------------------------------------- */
/* 人工覆盖                                                                   */
/* -------------------------------------------------------------------------- */

function OverridePanel({ cleaner }) {
  const initial =
    cleaner.quality_coef_override === null || cleaner.quality_coef_override === undefined
      ? ''
      : String(cleaner.quality_coef_override)
  const [value, setValue] = useState(initial)
  const [msg, setMsg] = useState(null)

  const save = () => {
    const text = value.trim()
    if (text === '') {
      setMsg({ ok: false, text: '请输入 0.80–1.20 之间的系数。' })
      return
    }
    const num = Number(text)
    if (!Number.isFinite(num)) {
      setMsg({ ok: false, text: '质量系数必须为数字。' })
      return
    }
    if (num < 0.8 || num > 1.2) {
      setMsg({ ok: false, text: '质量系数必须位于 0.80–1.20 之间。' })
      return
    }
    const result = setQualityOverride(cleaner.id, num)
    if (result.ok) {
      setMsg({
        ok: true,
        text: `已写入人工覆盖 ${Number(result.data.quality_coef_override).toFixed(2)}（来源 override），月结与明细已实时重算。`,
      })
    } else {
      setMsg({ ok: false, text: `${result.code}：${result.message}` })
    }
  }

  const clear = () => {
    const result = setQualityOverride(cleaner.id, null)
    if (result.ok) {
      setValue('')
      setMsg({ ok: true, text: '已清除覆盖，回到自动计算口径。' })
    } else {
      setMsg({ ok: false, text: `${result.code}：${result.message}` })
    }
  }

  return (
    <div className="cln-override">
      <div className="cln-override-head">
        <strong>人工覆盖质量系数</strong>
        <span className="muted">
          当前：
          {cleaner.quality_coef_override === null ||
          cleaner.quality_coef_override === undefined
            ? '未覆盖（按规则计算）'
            : `${Number(cleaner.quality_coef_override).toFixed(2)}（人工）`}
        </span>
      </div>
      <div className="cln-override-form">
        <label className="field">
          系数（0.80–1.20）
          <input
            type="number"
            min="0.8"
            max="1.2"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="例如 1.05"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={save}>
          应用覆盖
        </button>
        <button type="button" className="btn" onClick={clear}>
          清除覆盖
        </button>
      </div>
      {msg && (
        <div className={msg.ok ? 'cln-msg cln-msg-ok' : 'cln-msg cln-msg-err'} role="status">
          {msg.ok ? '操作成功：' : '操作失败：'}
          {msg.text}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                       */
/* -------------------------------------------------------------------------- */

/** M3 阿姨工时提成：KPI、月结总表、逐单明细、质量系数人工覆盖。 */
export default function CleanersPage() {
  const state = useStore((s) => s)
  const period = state.meta?.period || '2026-10'

  const [query, setQuery] = useState('')
  const [districtFilter, setDistrictFilter] = useState('all')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')
  const [exportMsg, setExportMsg] = useState('')

  const payroll = useMemo(() => selectPayroll(state, period), [state, period])

  const districtNameById = useMemo(() => {
    const map = new Map()
    for (const district of state.districts || []) map.set(district.id, district.name)
    return map
  }, [state.districts])

  const complaints = useMemo(() => {
    const cleanerByOrder = new Map()
    for (const order of state.orders || []) {
      if (REVENUE_STATUS.has(order.status) && periodOf(order.completed_at) === period) {
        cleanerByOrder.set(order.id, order.cleaner_id)
      }
    }
    const hit = new Set()
    let total = 0
    for (const complaint of state.complaints || []) {
      if (periodOf(complaint.created_at) !== period) continue
      const cleanerId = cleanerByOrder.get(complaint.order_id)
      if (!cleanerId) continue
      hit.add(cleanerId)
      total += 1
    }
    return { cleanerCount: hit.size, total }
  }, [state.orders, state.complaints, period])

  const displayRows = useMemo(
    () =>
      payroll.rows.map((row) => ({
        ...row,
        cleanerId: row.cleaner.id,
        districtName: districtNameById.get(row.cleaner.district_id) || row.cleaner.district_id,
        orderCount: row.lines.length,
        hours: row.totals.minutes / 60,
        source: row.quality?.source || 'default',
        coef: Number.isFinite(Number(row.quality?.coef)) ? Number(row.quality.coef) : 1,
      })),
    [payroll, districtNameById],
  )

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    let rows = displayRows
    if (keyword) {
      rows = rows.filter(
        (row) =>
          row.cleaner.name.toLowerCase().includes(keyword) ||
          row.cleaner.id.toLowerCase().includes(keyword),
      )
    }
    if (districtFilter !== 'all') {
      rows = rows.filter((row) => row.cleaner.district_id === districtFilter)
    }
    return rows
      .slice()
      .sort((a, b) =>
        sortDir === 'desc' ? b.totals.total - a.totals.total : a.totals.total - b.totals.total,
      )
  }, [displayRows, query, districtFilter, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const districtOptions = useMemo(() => {
    const ids = [...new Set(displayRows.map((row) => row.cleaner.district_id))]
    return ids.map((id) => ({ id, name: districtNameById.get(id) || id }))
  }, [displayRows, districtNameById])

  const activeCount = useMemo(
    () => (state.cleaners || []).filter((cleaner) => cleaner.status === 'active').length,
    [state.cleaners],
  )

  const avgCoef = useMemo(() => {
    if (!displayRows.length) return null
    let sum = 0
    for (const row of displayRows) sum += row.coef
    return sum / displayRows.length
  }, [displayRows])

  const activeId = selectedId || displayRows[0]?.cleanerId || ''

  const commission = useMemo(
    () => (activeId ? selectCleanerCommission(state, activeId, period) : null),
    [state, activeId, period],
  )
  const parts = useMemo(
    () => (activeId ? qualityParts(state, activeId, period) : null),
    [state, activeId, period],
  )
  const activeCommission = commission && commission.cleaner.id === activeId ? commission : null

  const selectCleaner = (cleanerId) => setSelectedId(cleanerId)

  const handleExport = () => {
    const columns = [
      { key: 'period', title: '账期', format: () => period },
      { key: 'name', title: '阿姨姓名', format: (row) => row.cleaner.name },
      { key: 'no', title: '工号', format: (row) => row.cleaner.id },
      { key: 'district', title: '片区', format: (row) => row.districtName },
      { key: 'orders', title: '完成单数', format: (row) => row.orderCount },
      { key: 'hours', title: '工时（小时）', format: (row) => row.hours.toFixed(1) },
      { key: 'coef', title: '质量系数', format: (row) => row.coef.toFixed(3) },
      { key: 'source', title: '系数来源', format: (row) => sourceMeta(row.source).label },
      { key: 'basePay', title: '基础提成（元）', format: (row) => csvMoney(row.totals.basePay) },
      { key: 'qualityPay', title: '质量奖扣（元）', format: (row) => csvMoney(row.totals.qualityPay) },
      { key: 'total', title: '合计（元）', format: (row) => csvMoney(row.totals.total) },
    ]
    const content = toCsv(columns, filteredRows)
    const filename = `提成月结_${period}.csv`
    const ok = downloadCsv(filename, content)
    setExportMsg(
      ok
        ? `已导出 ${filteredRows.length} 行：${filename}（UTF-8 BOM，金额单位为元）`
        : '当前环境不支持文件下载。',
    )
  }

  const payrollColumns = [
    {
      key: 'cleaner',
      title: '阿姨',
      render: (row) => (
        <div className="cln-person">
          <strong>{row.cleaner.name}</strong>
          <span>{row.cleaner.id}</span>
        </div>
      ),
    },
    {
      key: 'district',
      title: '片区',
      render: (row) => row.districtName,
    },
    {
      key: 'orders',
      title: '完成单数',
      align: 'right',
      render: (row) => <span className="num">{fmtNumber(row.orderCount)}</span>,
    },
    {
      key: 'hours',
      title: '工时（小时）',
      align: 'right',
      render: (row) => <span className="num">{fmtNumber(row.hours, 1)}</span>,
    },
    {
      key: 'coef',
      title: '质量系数',
      align: 'right',
      render: (row) => (
        <span className="row cln-coef-cell">
          <span className="num">{row.coef.toFixed(3)}</span>
          <Badge tone={sourceMeta(row.source).tone}>{sourceMeta(row.source).label}</Badge>
        </span>
      ),
    },
    {
      key: 'basePay',
      title: '基础提成',
      align: 'right',
      render: (row) => <Money cents={row.totals.basePay} />,
    },
    {
      key: 'qualityPay',
      title: '质量奖扣',
      align: 'right',
      render: (row) => <Money cents={row.totals.qualityPay} showSign />,
    },
    {
      key: 'total',
      title: '合计',
      align: 'right',
      render: (row) => (
        <strong>
          <Money cents={row.totals.total} />
        </strong>
      ),
    },
    {
      key: 'action',
      title: '明细',
      align: 'center',
      render: (row) => (
        <button
          type="button"
          className="btn"
          onClick={(event) => {
            event.stopPropagation()
            selectCleaner(row.cleanerId)
          }}
        >
          查看
        </button>
      ),
    },
  ]

  const detailColumns = [
    {
      key: 'order_no',
      title: '工单号',
      render: ({ order }) => (
        <div className="cln-order-cell">
          <span className="num">{order.order_no}</span>
          {order.is_rework && (
            <>
              <Badge tone="danger">返工</Badge>
              <span className="cln-rework-note">返工：时薪×50%、单量提成 0</span>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'completed_at',
      title: '完成时间',
      render: ({ order }) => <span className="num">{fmtDateTime(order.completed_at)}</span>,
    },
    {
      key: 'minutes',
      title: '时长（分钟）',
      align: 'right',
      render: ({ result }) => <span className="num">{fmtNumber(result.minutes)}</span>,
    },
    {
      key: 'hourlyPay',
      title: '时薪工资',
      align: 'right',
      render: ({ result }) => <Money cents={result.hourlyPay} />,
    },
    {
      key: 'orderPay',
      title: '单量提成',
      align: 'right',
      render: ({ order, result }) =>
        order.is_rework ? (
          <span className="cln-zero">0.00（返工）</span>
        ) : (
          <Money cents={result.orderPay} />
        ),
    },
    {
      key: 'qualityPay',
      title: '质量奖扣',
      align: 'right',
      render: ({ result }) => <Money cents={result.qualityPay} showSign />,
    },
    {
      key: 'total',
      title: '小计',
      align: 'right',
      render: ({ result }) => (
        <strong>
          <Money cents={result.total} />
        </strong>
      ),
    },
  ]

  const recentLines = activeCommission ? activeCommission.lines.slice(0, 50) : []
  const sampleSource = sourceMeta(activeCommission?.quality?.source)

  return (
    <section className="page">
      <style>{`
        .cln-person { display: flex; flex-direction: column; line-height: 1.35; }
        .cln-person span { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
        .cln-coef-cell { justify-content: flex-end; gap: 6px; flex-wrap: nowrap; }
        .cln-policy {
          padding: 12px 14px;
          border: 1px dashed var(--border-strong);
          border-radius: var(--radius);
          background: var(--surface-2);
          font-size: 12px;
          line-height: 1.75;
          color: var(--text-2);
        }
        .cln-policy strong { color: var(--accent-strong); }
        .cln-detail-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
        }
        .cln-detail-name { font-size: 19px; font-weight: 700; }
        .cln-detail-meta { margin-top: 3px; font-size: 12px; color: var(--muted); }
        .cln-qgrid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px; margin-bottom: 12px;
        }
        .cln-qitem {
          padding: 10px 12px; border: 1px solid var(--border);
          border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .cln-qlabel { font-size: 11px; color: var(--muted); }
        .cln-qvalue {
          margin-top: 4px; font-size: 16px; font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .cln-qsub { margin-top: 2px; font-size: 11px; color: var(--muted); }
        .cln-formula {
          padding: 10px 12px; border: 1px solid var(--border);
          border-radius: var(--radius-sm); background: var(--surface);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px; line-height: 1.8; color: var(--text-2);
          overflow-x: auto;
        }
        .cln-override {
          margin: 12px 0; padding: 12px;
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--surface-2);
        }
        .cln-override-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 10px; flex-wrap: wrap; font-size: 13px;
        }
        .cln-override-form {
          display: flex; align-items: flex-end; gap: 8px;
          flex-wrap: wrap; margin-top: 10px;
        }
        .cln-msg { margin-top: 8px; font-size: 12px; line-height: 1.6; }
        .cln-msg-ok { color: var(--success); }
        .cln-msg-err { color: var(--danger); }
        .cln-section-title {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 10px; flex-wrap: wrap; margin: 16px 0 8px;
          font-size: 13px; font-weight: 600;
        }
        .cln-order-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .cln-rework-note { font-size: 11px; color: var(--danger); }
        .cln-zero { color: var(--muted); font-variant-numeric: tabular-nums; }
        .cln-detail-totals {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px; margin-top: 14px;
        }
        .cln-total-item {
          padding: 10px 12px; border: 1px solid var(--border);
          border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .cln-total-item.is-strong { border-color: var(--accent); background: var(--accent-soft); }
        .cln-total-label { font-size: 11px; color: var(--muted); }
        .cln-total-value {
          margin-top: 4px; font-size: 15px; font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .cln-calc-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
        }
        .cln-calc-item {
          padding: 10px 12px; border: 1px solid var(--border);
          border-radius: var(--radius-sm); background: var(--surface-2);
        }
        .cln-calc-item.is-total { border-color: var(--accent); background: var(--accent-soft); }
        .cln-calc-label { font-size: 11px; color: var(--muted); }
        .cln-calc-value {
          margin-top: 4px; font-size: 16px; font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .cln-sample-note { margin-top: 10px; font-size: 12px; line-height: 1.7; color: var(--muted); }
        .cln-export-note { margin-top: 8px; font-size: 12px; color: var(--success); }
        .cln-warn { margin-top: 6px; font-size: 11px; color: var(--warning); }
      `}</style>

      <header className="page-head">
        <div>
          <span className="page-code">{PAGE_CODE}</span>
          <h1>阿姨工时提成</h1>
          <p className="muted">
            账期 {period} · 工时/提成由 domain 纯函数实时计算 · 月结总表、逐单明细与质量系数覆盖
          </p>
        </div>
        <div className="row">
          <Badge tone="info">账期 {period}</Badge>
          <Badge tone="neutral">{payroll.rows.length} 位阿姨</Badge>
        </div>
      </header>

      <div className="stat-grid">
        <StatTile
          label="在职阿姨数"
          value={fmtNumber(activeCount)}
          hint={`${payroll.rows.length} 位建档 · 停用 ${Math.max(0, payroll.rows.length - activeCount)} 位`}
          tone="info"
        />
        <StatTile
          label="账期总工时（小时）"
          value={fmtNumber(payroll.summary.minutes / 60, 1)}
          hint={`分钟合计 ${fmtNumber(payroll.summary.minutes)}`}
          tone="neutral"
        />
        <StatTile
          label="应发提成总额"
          value={<Money cents={payroll.summary.total} />}
          hint={`${fmtNumber(payroll.summary.orderCount)} 单 · selectPayroll.summary.total`}
          tone="accent"
        />
        <StatTile
          label="平均质量系数"
          value={avgCoef === null ? '—' : avgCoef.toFixed(3)}
          hint={`${fmtNumber(payroll.rows.length)} 位阿姨账期均值 · 三位小数`}
          tone="success"
        />
        <StatTile
          label="有投诉阿姨数"
          value={fmtNumber(complaints.cleanerCount)}
          hint={`账期内 ${fmtNumber(complaints.total)} 起有效关联投诉`}
          tone={complaints.cleanerCount > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="cln-policy">
        <strong>口径唯一：</strong>
        提成全部由纯函数计算，页面不做二次算术，因此「提成算错率 → 0」；settlements
        为历史快照，以实时计算为准。逐单金额调用 <code>calcCommission</code>，质量系数调用{' '}
        <code>calcQualityCoef</code>，月结与明细同源、可复算。
      </div>

      <Card
        title="月结总表"
        subtitle={`selectPayroll(state, '${period}') · ${payroll.rows.length} 行 · 基础提成 = 时薪工资 + 单量提成`}
        actions={<Badge tone="neutral">筛选后 {filteredRows.length} 行</Badge>}
      >
        {displayRows.length === 0 ? (
          <EmptyState
            title="本账期暂无可结算阿姨"
            hint="请切换账期或检查种子数据后重试。"
          />
        ) : (
          <>
            <FilterBar
              actions={
                <button type="button" className="btn btn-primary" onClick={handleExport}>
                  导出 CSV
                </button>
              }
            >
              <label className="field">
                搜索姓名 / 工号
                <input
                  type="search"
                  value={query}
                  placeholder="例如 黄雪梅 或 C-0001"
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  }}
                />
              </label>
              <label className="field">
                片区
                <select
                  value={districtFilter}
                  onChange={(event) => {
                    setDistrictFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="all">全部片区</option>
                  {districtOptions.map((district) => (
                    <option key={district.id} value={district.id}>
                      {district.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                按合计排序
                <select
                  value={sortDir}
                  onChange={(event) => {
                    setSortDir(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="desc">降序（高 → 低）</option>
                  <option value="asc">升序（低 → 高）</option>
                </select>
              </label>
            </FilterBar>

            <div style={{ height: 12 }} />

            <Table
              columns={payrollColumns}
              rows={pageRows}
              rowKey={(row) => row.cleanerId}
              onRowClick={(row) => selectCleaner(row.cleanerId)}
              empty="没有符合条件的阿姨"
              emptyHint="请调整搜索关键字或片区筛选。"
              caption="阿姨月结提成总表"
            />

            <Pagination
              page={currentPage}
              pageSize={PAGE_SIZE}
              total={filteredRows.length}
              onChange={setPage}
            />
            {exportMsg && <div className="cln-export-note">{exportMsg}</div>}
          </>
        )}
      </Card>

      <Card
        title={activeCommission ? `提成明细 · ${activeCommission.cleaner.name}` : '提成明细'}
        subtitle={
          activeCommission
            ? `${activeCommission.cleaner.id} · 账期 ${period} · selectCleanerCommission 实时计算`
            : '点击月结总表中的任意行查看'
        }
        actions={
          activeCommission ? (
            <Badge tone={sampleSource.tone}>
              系数 {activeCommission.quality.coef.toFixed(2)} · {sampleSource.cn}
            </Badge>
          ) : null
        }
      >
        {!activeCommission ? (
          <EmptyState
            title="请选择一位阿姨"
            hint="点击月结总表中的任意行，查看质量系数构成、逐单提成与人工覆盖结果。"
          />
        ) : (
          <>
            <div className="cln-detail-head">
              <div>
                <div className="cln-detail-name">{activeCommission.cleaner.name}</div>
                <div className="cln-detail-meta">
                  {activeCommission.cleaner.id} ·{' '}
                  {districtNameById.get(activeCommission.cleaner.district_id) || '—'} ·{' '}
                  {activeCommission.cleaner.employment === 'parttime' ? '兼职' : '全职'} ·{' '}
                  {activeCommission.cleaner.status === 'active' ? '在职' : '停用'} · 时薪{' '}
                  {formatYuan(activeCommission.cleaner.hourly_rate)}/小时 · 单量提成率{' '}
                  {toPct(activeCommission.cleaner.base_rate, 0)}
                </div>
              </div>
              <div className="row">
                <Badge tone={sampleSource.tone}>{sampleSource.cn}</Badge>
                <Badge tone="neutral">质量系数 {activeCommission.quality.coef.toFixed(3)}</Badge>
              </div>
            </div>

            <div className="cln-qgrid">
              <div className="cln-qitem">
                <div className="cln-qlabel">完成单数</div>
                <div className="cln-qvalue">{fmtNumber(parts.orders)}</div>
                <div className="cln-qsub">账期内 completed / closed</div>
              </div>
              <div className="cln-qitem">
                <div className="cln-qlabel">准时单数 / 准时率</div>
                <div className="cln-qvalue">
                  {fmtNumber(parts.onTime)} / {fmtNumber(parts.orders)}
                </div>
                <div className="cln-qsub">
                  {pctOf(parts.onTime, parts.orders)} · 签到与预约差 ≤15 分钟
                </div>
              </div>
              <div className="cln-qitem">
                <div className="cln-qlabel">投诉数 / 投诉率</div>
                <div className="cln-qvalue">
                  {fmtNumber(parts.complaints)} / {fmtNumber(parts.orders)}
                </div>
                <div className="cln-qsub">
                  {pctOf(parts.complaints, parts.orders)} · 账期内关联投诉
                </div>
              </div>
              <div className="cln-qitem">
                <div className="cln-qlabel">返工数 / 返工率</div>
                <div className="cln-qvalue">
                  {fmtNumber(parts.reworks)} / {fmtNumber(parts.orders)}
                </div>
                <div className="cln-qsub">
                  {pctOf(parts.reworks, parts.orders)} · 账期内返工记录
                </div>
              </div>
            </div>

            <div className="cln-formula">
              质量系数 = 1 + 0.20 × (准时率 − 0.90) − 0.50 × 投诉率 − 0.30 × 返工率
              <br />
              coef = round2(clamp(raw, 0.80, 1.20))；人工覆盖优先于自动计算（docs §3.3）。
            </div>
            {activeCommission.quality.warnings?.length > 0 && (
              <div className="cln-warn">
                系数警告：{activeCommission.quality.warnings.join('；')}
              </div>
            )}

            <OverridePanel key={activeCommission.cleaner.id} cleaner={activeCommission.cleaner} />

            <div className="cln-section-title">
              <span>逐单提成明细</span>
              <span className="muted">
                共 {fmtNumber(activeCommission.lines.length)} 单
                {activeCommission.lines.length > 50 ? ' · 仅展示最近 50 单' : ''}
                ；下方合计为全账期总计
              </span>
            </div>

            <Table
              columns={detailColumns}
              rows={recentLines}
              rowKey={(line) => line.order.id}
              dense
              empty="本账期暂无完成工单"
              emptyHint="该阿姨在所选账期没有 completed / closed 工单。"
              caption="阿姨逐单提成明细"
            />

            <div className="cln-detail-totals">
              <div className="cln-total-item">
                <div className="cln-total-label">工时（小时）</div>
                <div className="cln-total-value">
                  {fmtNumber(activeCommission.totals.minutes / 60, 1)}
                </div>
              </div>
              <div className="cln-total-item">
                <div className="cln-total-label">时薪工资</div>
                <div className="cln-total-value">
                  <Money cents={activeCommission.totals.hourlyPay} />
                </div>
              </div>
              <div className="cln-total-item">
                <div className="cln-total-label">单量提成</div>
                <div className="cln-total-value">
                  <Money cents={activeCommission.totals.orderPay} />
                </div>
              </div>
              <div className="cln-total-item">
                <div className="cln-total-label">基础提成</div>
                <div className="cln-total-value">
                  <Money cents={activeCommission.totals.basePay} />
                </div>
              </div>
              <div className="cln-total-item">
                <div className="cln-total-label">质量奖扣</div>
                <div className="cln-total-value">
                  <Money cents={activeCommission.totals.qualityPay} showSign />
                </div>
              </div>
              <div className="cln-total-item is-strong">
                <div className="cln-total-label">应发合计</div>
                <div className="cln-total-value">
                  <Money cents={activeCommission.totals.total} />
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card
        title="口径示例 · calcCommission 实算"
        subtitle="输入与 docs §3.2 种子验收算例完全一致，页面直接展示纯函数返回值，不做二次算术"
      >
        <div className="cln-calc-grid">
          <div className="cln-calc-item">
            <div className="cln-calc-label">计费时长</div>
            <div className="cln-calc-value">{fmtNumber(SAMPLE.minutes)} 分钟</div>
          </div>
          <div className="cln-calc-item">
            <div className="cln-calc-label">时长工资（hourlyPay）</div>
            <div className="cln-calc-value">
              <Money cents={SAMPLE.hourlyPay} />
            </div>
          </div>
          <div className="cln-calc-item">
            <div className="cln-calc-label">单量提成（orderPay）</div>
            <div className="cln-calc-value">
              <Money cents={SAMPLE.orderPay} />
            </div>
          </div>
          <div className="cln-calc-item">
            <div className="cln-calc-label">基础提成（basePay）</div>
            <div className="cln-calc-value">
              <Money cents={SAMPLE.basePay} />
            </div>
          </div>
          <div className="cln-calc-item">
            <div className="cln-calc-label">质量奖扣（qualityPay）</div>
            <div className="cln-calc-value">
              <Money cents={SAMPLE.qualityPay} showSign />
            </div>
          </div>
          <div className="cln-calc-item is-total">
            <div className="cln-calc-label">应发合计（total）</div>
            <div className="cln-calc-value">
              <Money cents={SAMPLE.total} />（{fmtNumber(SAMPLE.total)} 分）
            </div>
          </div>
        </div>
        <p className="cln-sample-note">
          输入：120 分钟、时薪 25 元（2,500 分）、工单 150 元（15,000 分）、baseRate 0.15、
          质量系数 1.05。输出：时长工资 50.00、单量提成 22.50、基础 72.50、质量奖扣 3.63、
          合计 76.13 元（7,613 分）。与 docs §3.2 验收值一致。
        </p>
      </Card>
    </section>
  )
}
