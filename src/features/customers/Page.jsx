import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store.js'
import { selectCustomer360 } from '../../store/selectors.js'
import { CUSTOMER_STATUS } from '../../domain/types.js'
import {
  Badge,
  Card,
  EmptyState,
  FilterBar,
  Money,
  Pagination,
  StatTile,
  StatusBadge,
  Table,
} from '../../components/ui.jsx'
import { fmtDate, fmtDateTime, fmtNumber, truncate } from '../../lib/format.js'
import { downloadCsv, toCsv } from '../../lib/csv.js'

const PAGE_SIZE = 20
const RECENT_ORDER_LIMIT = 20
/** 账期结束时间（2026-10，Asia/Shanghai）。 */
const PERIOD_END_ISO = '2026-10-31T23:59:59+08:00'
const PERIOD_END_MS = Date.parse(PERIOD_END_ISO)
const DAY_MS = 24 * 60 * 60 * 1000

const CUSTOMER_STATUS_LABELS = {
  active: '活跃',
  churn_risk: '流失风险',
  churned: '已流失',
}

const SORT_OPTIONS = [
  { value: 'amount_desc', label: '累计金额降序' },
  { value: 'complaint_desc', label: '投诉次数降序' },
  { value: 'last_order_desc', label: '最近下单时间降序' },
]

const SERVICE_TYPE_LABELS = {
  daily: '日常保洁',
  deep: '深度保洁',
  opening: '开荒玻璃',
}

const COMPLAINT_CATEGORY_LABELS = {
  damage: '物品损坏',
  late: '迟到',
  quality: '质量',
  attitude: '态度',
  other: '其他',
}

const COMPENSATION_REASON_LABELS = {
  wash_damage: '洗坏',
  scratch: '刮花',
  lost: '丢失',
  other: '其他',
}

const RESPONSIBILITY_LABELS = {
  cleaner: '阿姨',
  customer: '客户',
  product: '产品',
  none: '无责',
  undetermined: '待定',
}

const TAG_TONES = {
  高价值: 'accent',
  风险观察: 'warning',
  赔付关注: 'danger',
}

function timeValue(value) {
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : -Infinity
}

function compareCustomers(a, b, sortKey) {
  if (sortKey === 'complaint_desc') {
    const diff = (Number(b.complaint_count) || 0) - (Number(a.complaint_count) || 0)
    if (diff) return diff
  } else if (sortKey === 'last_order_desc') {
    const diff = timeValue(b.last_order_at) - timeValue(a.last_order_at)
    if (diff) return diff
  } else {
    const diff = (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0)
    if (diff) return diff
  }
  return String(a.id).localeCompare(String(b.id))
}

function yuanPlain(fen) {
  const n = Number(fen)
  return Number.isFinite(n) ? (n / 100).toFixed(2) : '0.00'
}

function tagTone(tag) {
  return TAG_TONES[tag] || 'neutral'
}

function CustomerTags({ tags, limit = 3 }) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : []
  if (list.length === 0) return <span className="muted">—</span>
  const shown = list.slice(0, limit)
  const extra = list.length - shown.length
  return (
    <span className="cus-tags">
      {shown.map((tag) => (
        <Badge key={tag} tone={tagTone(tag)}>
          {tag}
        </Badge>
      ))}
      {extra > 0 && <span className="cus-tag-more">+{extra}</span>}
    </span>
  )
}

/** M4 客户档案：KPI、筛选列表、客户 360 与脱敏导出。 */
export default function CustomersPage() {
  const state = useStore((s) => s)

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sortKey, setSortKey] = useState('amount_desc')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)

  const detailRef = useRef(null)

  const customers = state.customers || []

  const districtsById = useMemo(
    () => new Map((state.districts || []).map((d) => [d.id, d])),
    [state.districts],
  )
  const cleanersById = useMemo(
    () => new Map((state.cleaners || []).map((c) => [c.id, c])),
    [state.cleaners],
  )
  const compensationsById = useMemo(
    () => new Map((state.compensations || []).map((c) => [c.id, c])),
    [state.compensations],
  )

  /* ----------------------------- KPI ----------------------------- */
  const kpis = useMemo(() => {
    let active = 0
    let churnRisk = 0
    let churned = 0
    let compensationFocus = 0
    let amountSum = 0
    for (const customer of customers) {
      if (customer.status === 'active') active += 1
      else if (customer.status === 'churn_risk') churnRisk += 1
      else if (customer.status === 'churned') churned += 1
      if (Array.isArray(customer.tags) && customer.tags.includes('赔付关注')) {
        compensationFocus += 1
      }
      amountSum += Number(customer.total_amount) || 0
    }
    return {
      total: customers.length,
      active,
      churnRisk,
      churned,
      compensationFocus,
      avgAmount: customers.length > 0 ? Math.round(amountSum / customers.length) : 0,
    }
  }, [customers])

  const districtOptions = useMemo(() => {
    const ids = new Set(customers.map((c) => c.district_id).filter(Boolean))
    return (state.districts || [])
      .filter((d) => ids.has(d.id))
      .map((d) => ({ id: d.id, name: d.name || d.id }))
  }, [customers, state.districts])

  const tagOptions = useMemo(() => {
    const set = new Set()
    for (const customer of customers) {
      for (const tag of customer.tags || []) set.add(tag)
    }
    const preferred = Object.keys(TAG_TONES)
    return [...set].sort((a, b) => {
      const ia = preferred.indexOf(a)
      const ib = preferred.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })
  }, [customers])

  /* --------------------------- 筛选排序 --------------------------- */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return customers
      .filter((customer) => {
        if (statusFilter && customer.status !== statusFilter) return false
        if (districtFilter && customer.district_id !== districtFilter) return false
        if (tagFilter && !(customer.tags || []).includes(tagFilter)) return false
        if (kw) {
          const haystack = `${customer.name || ''} ${customer.id || ''} ${
            customer.phone_masked || ''
          }`.toLowerCase()
          if (!haystack.includes(kw)) return false
        }
        return true
      })
      .slice()
      .sort((a, b) => compareCustomers(a, b, sortKey))
  }, [customers, keyword, statusFilter, districtFilter, tagFilter, sortKey])

  useEffect(() => {
    setPage(1)
  }, [keyword, statusFilter, districtFilter, tagFilter, sortKey])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const hasFilter =
    Boolean(keyword.trim()) ||
    Boolean(statusFilter) ||
    Boolean(districtFilter) ||
    Boolean(tagFilter) ||
    sortKey !== 'amount_desc'

  const resetFilters = () => {
    setKeyword('')
    setStatusFilter('')
    setDistrictFilter('')
    setTagFilter('')
    setSortKey('amount_desc')
  }

  /* --------------------------- 客户 360 --------------------------- */
  const detail = useMemo(
    () => (selectedId ? selectCustomer360(state, selectedId) : null),
    [state, selectedId],
  )

  const detailData = useMemo(() => {
    if (!detail) return null
    const customer = detail.customer

    const orders = detail.orders
      .slice()
      .sort((a, b) => timeValue(b.completed_at) - timeValue(a.completed_at))
      .slice(0, RECENT_ORDER_LIMIT)

    const complaints = detail.complaints
      .slice()
      .sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at))

    const compensations = detail.compensations
      .slice()
      .sort(
        (a, b) =>
          timeValue(b.approved_at || b.decided_at) - timeValue(a.approved_at || a.decided_at),
      )

    const signals = []
    if (customer.status === 'churn_risk') {
      signals.push({
        key: 'churn_risk',
        tone: 'warning',
        label: '流失风险',
        text: '客户状态标记为 churn_risk（流失风险）',
      })
    } else if (customer.status === 'churned') {
      signals.push({
        key: 'churned',
        tone: 'danger',
        label: '已流失',
        text: '客户状态为 churned（已流失）',
      })
    }

    const complaintCount = Math.max(
      Number(customer.complaint_count) || 0,
      complaints.length,
    )
    if (complaintCount >= 2) {
      signals.push({
        key: 'complaints',
        tone: 'danger',
        label: '投诉',
        text: `累计投诉 ${complaintCount} 次（≥2 次），需复核服务与赔付链路`,
      })
    }

    if (!customer.last_order_at) {
      signals.push({
        key: 'no_order',
        tone: 'info',
        label: '无记录',
        text: '无历史下单记录，档案仅有基础资料',
      })
    } else {
      const lastMs = timeValue(customer.last_order_at)
      const days = Number.isFinite(lastMs)
        ? Math.floor((PERIOD_END_MS - lastMs) / DAY_MS)
        : null
      if (days !== null && days > 30) {
        signals.push({
          key: 'inactive',
          tone: 'warning',
          label: '久未下单',
          text: `最近下单距账期末（${fmtDate(PERIOD_END_ISO)}）已 ${days} 天（>30 天）`,
        })
      }
    }

    return { customer, orders, complaints, compensations, signals }
  }, [detail])

  useEffect(() => {
    if (
      selectedId &&
      detailRef.current &&
      typeof detailRef.current.scrollIntoView === 'function'
    ) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedId])

  /* ----------------------------- 导出 ----------------------------- */
  const handleExport = () => {
    const columns = [
      { key: 'id', title: '客户ID' },
      { key: 'name', title: '姓名' },
      { key: 'phone_masked', title: '手机号(已脱敏)' },
      {
        key: 'district',
        title: '片区',
        format: (row) => districtsById.get(row.district_id)?.name || row.district_id || '',
      },
      {
        key: 'total_orders',
        title: '累计单数',
        format: (row) => Number(row.total_orders) || 0,
      },
      { key: 'total_amount', title: '累计金额', format: (row) => yuanPlain(row.total_amount) },
      {
        key: 'complaint_count',
        title: '投诉次数',
        format: (row) => Number(row.complaint_count) || 0,
      },
      {
        key: 'compensation_amount',
        title: '赔付金额',
        format: (row) => yuanPlain(row.compensation_amount),
      },
      {
        key: 'status',
        title: '状态',
        format: (row) => CUSTOMER_STATUS_LABELS[row.status] || row.status || '',
      },
      { key: 'tags', title: '标签', format: (row) => (row.tags || []).join('、') },
    ]
    downloadCsv('客户档案_脱敏.csv', toCsv(columns, filtered))
  }

  /* ----------------------------- 列定义 --------------------------- */
  const listColumns = [
    {
      key: 'name',
      title: '客户',
      width: '190px',
      render: (row) => (
        <div className="cus-name">
          <span className="cus-name-main">
            <strong>{row.name || '—'}</strong>
            {selectedId === row.id && <Badge tone="accent">已选</Badge>}
          </span>
          <span className="cus-id">{row.id}</span>
        </div>
      ),
    },
    {
      key: 'district_id',
      title: '片区',
      render: (row) => districtsById.get(row.district_id)?.name || row.district_id || '—',
    },
    {
      key: 'phone_masked',
      title: '手机号',
      render: (row) => <span className="cus-phone">{row.phone_masked || '—'}</span>,
    },
    {
      key: 'total_orders',
      title: '累计单数',
      align: 'right',
      render: (row) => <span className="num">{fmtNumber(row.total_orders || 0)}</span>,
    },
    {
      key: 'total_amount',
      title: '累计金额',
      align: 'right',
      render: (row) => <Money cents={row.total_amount} />,
    },
    {
      key: 'complaint_count',
      title: '投诉次数',
      align: 'right',
      render: (row) => (
        <span className={Number(row.complaint_count) > 0 ? 'num cus-num-danger' : 'num'}>
          {fmtNumber(row.complaint_count || 0)}
        </span>
      ),
    },
    {
      key: 'compensation_amount',
      title: '赔付金额',
      align: 'right',
      render: (row) => <Money cents={row.compensation_amount} />,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'tags',
      title: '标签',
      render: (row) => <CustomerTags tags={row.tags} />,
    },
    {
      key: 'actions',
      title: '操作',
      align: 'center',
      render: (row) => (
        <button
          type="button"
          className="btn cus-view-btn"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedId(row.id)
          }}
        >
          查看 360
        </button>
      ),
    },
  ]

  const orderColumns = [
    {
      key: 'order_no',
      title: '工单号',
      render: (row) => <span className="cus-mono">{row.order_no || row.id}</span>,
    },
    {
      key: 'completed_at',
      title: '完成时间',
      render: (row) => fmtDateTime(row.completed_at),
    },
    {
      key: 'service_type',
      title: '服务类型',
      render: (row) => SERVICE_TYPE_LABELS[row.service_type] || row.service_type || '—',
    },
    {
      key: 'amount',
      title: '金额',
      align: 'right',
      render: (row) => <Money cents={row.amount} />,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'cleaner_id',
      title: '阿姨',
      render: (row) => cleanersById.get(row.cleaner_id)?.name || row.cleaner_id || '—',
    },
  ]

  const complaintColumns = [
    {
      key: 'created_at',
      title: '时间',
      render: (row) => fmtDateTime(row.created_at),
    },
    {
      key: 'category',
      title: '分类',
      render: (row) => COMPLAINT_CATEGORY_LABELS[row.category] || row.category || '—',
    },
    {
      key: 'content',
      title: '内容',
      render: (row) => (
        <span title={row.content || ''}>{truncate(row.content || '—', 36)}</span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'compensation_id',
      title: '关联赔付',
      render: (row) => {
        if (!row.compensation_id) return <span className="muted">—</span>
        const comp = compensationsById.get(row.compensation_id)
        return (
          <span className="cus-comp-link">
            <span className="cus-mono">{row.compensation_id}</span>
            {comp && (
              <span className="cus-comp-meta">
                <Money cents={comp.amount} /> · <StatusBadge status={comp.status} />
              </span>
            )}
          </span>
        )
      },
    },
  ]

  const compensationColumns = [
    {
      key: 'id',
      title: '赔付号',
      render: (row) => <span className="cus-mono">{row.id}</span>,
    },
    {
      key: 'reason',
      title: '原因',
      render: (row) => COMPENSATION_REASON_LABELS[row.reason] || row.reason || '—',
    },
    {
      key: 'responsibility',
      title: '责任方',
      render: (row) => RESPONSIBILITY_LABELS[row.responsibility] || row.responsibility || '—',
    },
    {
      key: 'amount',
      title: '金额',
      align: 'right',
      render: (row) => <Money cents={row.amount} />,
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  /* ----------------------------- 渲染 ----------------------------- */
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M4</span>
          <h1>客户档案</h1>
          <p className="muted">客户列表、客户 360、流失预警与脱敏导出</p>
        </div>
      </header>

      <div className="cus-notice" role="note">
        <span>
          隐私声明：数据全部虚构，手机号已脱敏；导出仅用于教学演示，请勿用于真实客户运营。
        </span>
      </div>

      <div className="stat-grid">
        <StatTile
          label="客户总数"
          value={fmtNumber(kpis.total)}
          hint="含全部片区客户"
          tone="accent"
        />
        <StatTile
          label="活跃客户"
          value={fmtNumber(kpis.active)}
          hint="status = active"
          tone="success"
        />
        <StatTile
          label="流失风险"
          value={fmtNumber(kpis.churnRisk)}
          hint="status = churn_risk"
          tone="warning"
        />
        <StatTile
          label="已流失"
          value={fmtNumber(kpis.churned)}
          hint="status = churned"
          tone="danger"
        />
        <StatTile
          label="赔付关注客户"
          value={fmtNumber(kpis.compensationFocus)}
          hint="标签含「赔付关注」"
          tone="danger"
        />
        <StatTile
          label="平均累计消费"
          value={<Money cents={kpis.avgAmount} />}
          hint="累计金额均值（元）"
          tone="info"
        />
      </div>

      <div className="cus-conclusion">
        结论：客户档案把「每个客户」的历史单、投诉、赔付与流失信号串成一条链，可回答「这个客户为什么走了、赔了多少」。
      </div>

      <Card
        title="客户列表"
        subtitle={`共 ${fmtNumber(customers.length)} 户 · 点击行或「查看 360」查看客户全链路`}
        actions={<span className="cus-count">筛选结果 {fmtNumber(filtered.length)} 户</span>}
        footer="数据全部虚构 · 手机号已脱敏 · 导出文件仅用于教学演示（客户档案_脱敏.csv）"
      >
        <FilterBar
          className="cus-filter"
          actions={
            <>
              {hasFilter && (
                <button type="button" className="btn" onClick={resetFilters}>
                  重置筛选
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={handleExport}>
                导出脱敏 CSV
              </button>
            </>
          }
        >
          <label className="field cus-search">
            <span>关键词</span>
            <input
              type="search"
              value={keyword}
              placeholder="姓名 / 手机号 / 客户ID"
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
          <label className="field">
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">全部状态</option>
              {CUSTOMER_STATUS.map((status) => (
                <option key={status} value={status}>
                  {CUSTOMER_STATUS_LABELS[status] || status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>片区</span>
            <select
              value={districtFilter}
              onChange={(event) => setDistrictFilter(event.target.value)}
            >
              <option value="">全部片区</option>
              {districtOptions.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>标签</span>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="">全部标签</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="field cus-sort">
            <span>排序</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </FilterBar>

        <Table
          columns={listColumns}
          rows={pageRows}
          rowKey="id"
          dense
          empty="没有符合条件的客户"
          emptyHint="请调整关键词、状态、片区或标签筛选。"
          onRowClick={(row) => setSelectedId(row.id)}
        />

        <Pagination
          page={safePage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onChange={setPage}
        />
      </Card>

      <div ref={detailRef} className="cus-360-anchor">
        {selectedId && !detail && (
          <Card title="客户 360">
            <EmptyState
              title="未找到该客户"
              hint="客户可能已被重置或不存在，请重新选择。"
            />
          </Card>
        )}

        {detailData && (
          <Card
            title={`客户 360 · ${detailData.customer.name || '—'}（${detailData.customer.id}）`}
            subtitle="资料、指标、历史工单、投诉与赔付、流失信号一链到底"
            actions={
              <button type="button" className="btn" onClick={() => setSelectedId(null)}>
                收起 360
              </button>
            }
            footer="本档案数据全部虚构；手机号已脱敏，仅用于教学演示。"
          >
            <dl className="cus-profile">
              <div className="cus-profile-item">
                <dt>姓名</dt>
                <dd>{detailData.customer.name || '—'}</dd>
              </div>
              <div className="cus-profile-item">
                <dt>手机号（脱敏）</dt>
                <dd className="cus-phone">{detailData.customer.phone_masked || '—'}</dd>
              </div>
              <div className="cus-profile-item">
                <dt>片区</dt>
                <dd>
                  {districtsById.get(detailData.customer.district_id)?.name ||
                    detailData.customer.district_id ||
                    '—'}
                </dd>
              </div>
              <div className="cus-profile-item">
                <dt>地址</dt>
                <dd>{detailData.customer.address || '—'}</dd>
              </div>
              <div className="cus-profile-item">
                <dt>首单时间</dt>
                <dd>{fmtDate(detailData.customer.first_order_at)}</dd>
              </div>
              <div className="cus-profile-item">
                <dt>最近下单</dt>
                <dd>{fmtDate(detailData.customer.last_order_at)}</dd>
              </div>
              <div className="cus-profile-item">
                <dt>标签</dt>
                <dd>
                  <CustomerTags tags={detailData.customer.tags} limit={6} />
                </dd>
              </div>
              <div className="cus-profile-item">
                <dt>状态</dt>
                <dd>
                  <StatusBadge status={detailData.customer.status} />
                </dd>
              </div>
            </dl>

            <div className="cus-metrics">
              <div className="cus-metric">
                <span className="cus-metric-label">累计单数</span>
                <span className="cus-metric-value">
                  {fmtNumber(detailData.customer.total_orders || 0)}
                </span>
              </div>
              <div className="cus-metric">
                <span className="cus-metric-label">累计金额</span>
                <span className="cus-metric-value">
                  <Money cents={detailData.customer.total_amount} />
                </span>
              </div>
              <div className="cus-metric">
                <span className="cus-metric-label">投诉数</span>
                <span className="cus-metric-value">
                  {fmtNumber(detailData.customer.complaint_count || 0)}
                </span>
              </div>
              <div className="cus-metric">
                <span className="cus-metric-label">赔付额</span>
                <span className="cus-metric-value">
                  <Money cents={detailData.customer.compensation_amount} />
                </span>
              </div>
            </div>

            <div
              className={detailData.signals.length > 0 ? 'cus-signals' : 'cus-signals is-ok'}
            >
              <div className="cus-signals-head">
                <span>流失信号</span>
                <span className="cus-signals-count">
                  {detailData.signals.length > 0 ? `${detailData.signals.length} 条` : '健康'}
                </span>
              </div>
              {detailData.signals.length > 0 ? (
                <ul className="cus-signal-list">
                  {detailData.signals.map((signal) => (
                    <li key={signal.key} className="cus-signal">
                      <Badge tone={signal.tone}>{signal.label}</Badge>
                      <span>{signal.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cus-ok">暂无风险信号</p>
              )}
            </div>

            <h3 className="cus-section-title">历史工单（最近 {RECENT_ORDER_LIMIT} 单）</h3>
            <Table
              columns={orderColumns}
              rows={detailData.orders}
              rowKey="id"
              dense
              empty="暂无历史工单"
              emptyHint="该客户尚无下单记录。"
            />

            <h3 className="cus-section-title">投诉记录（{detailData.complaints.length}）</h3>
            <Table
              columns={complaintColumns}
              rows={detailData.complaints}
              rowKey="id"
              dense
              empty="暂无投诉记录"
            />

            <h3 className="cus-section-title">
              赔付记录（{detailData.compensations.length}）
            </h3>
            <Table
              columns={compensationColumns}
              rows={detailData.compensations}
              rowKey="id"
              dense
              empty="暂无赔付记录"
            />
          </Card>
        )}
      </div>

      <style>{`
        .cus-notice {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border: 1px dashed var(--border-strong);
          border-radius: var(--radius-sm);
          background: var(--surface-2);
          color: var(--muted);
          font-size: 12px;
          line-height: 1.6;
        }

        .cus-conclusion {
          padding: 12px 16px;
          border: 1px solid rgba(15, 118, 110, 0.25);
          border-left: 4px solid var(--accent);
          border-radius: var(--radius-sm);
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.6;
        }

        .cus-filter {
          margin-bottom: 12px;
        }

        .cus-search input {
          width: 220px;
        }

        .cus-sort select {
          min-width: 150px;
        }

        .cus-count {
          font-size: 12px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }

        .cus-name {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .cus-name-main {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .cus-name-main strong {
          font-weight: 600;
          color: var(--text);
        }

        .cus-id {
          font-size: 11px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }

        .cus-phone {
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
        }

        .cus-tags {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }

        .cus-tag-more {
          font-size: 11px;
          color: var(--muted);
        }

        .cus-num-danger {
          color: var(--danger);
          font-weight: 600;
        }

        .cus-view-btn {
          padding: 4px 8px;
          font-size: 12px;
          white-space: nowrap;
        }

        .cus-mono {
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        .cus-360-anchor {
          scroll-margin-top: 84px;
        }

        .cus-profile {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 14px 20px;
          margin: 0 0 18px;
          padding: 14px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface-2);
        }

        .cus-profile-item {
          margin: 0;
          min-width: 0;
        }

        .cus-profile-item dt {
          margin-bottom: 3px;
          font-size: 11px;
          color: var(--muted);
        }

        .cus-profile-item dd {
          margin: 0;
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
          word-break: break-all;
        }

        .cus-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
          margin-bottom: 4px;
        }

        .cus-metric {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface);
        }

        .cus-metric-label {
          font-size: 11px;
          color: var(--muted);
        }

        .cus-metric-value {
          font-size: 17px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--text);
        }

        .cus-signals {
          margin-top: 16px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface-2);
        }

        .cus-signals.is-ok {
          border-color: rgba(4, 120, 87, 0.25);
          background: var(--success-soft);
        }

        .cus-signals-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-2);
        }

        .cus-signals-count {
          font-size: 11px;
          font-weight: 500;
          color: var(--muted);
        }

        .cus-signal-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin: 10px 0 0;
          padding: 0;
          list-style: none;
        }

        .cus-signal {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-2);
        }

        .cus-ok {
          margin: 8px 0 0;
          font-size: 12px;
          font-weight: 500;
          color: var(--success);
        }

        .cus-section-title {
          margin: 22px 0 8px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }

        .cus-comp-link {
          display: inline-flex;
          flex-direction: column;
          gap: 2px;
        }

        .cus-comp-meta {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--muted);
        }

        @media (max-width: 720px) {
          .cus-search input {
            width: 100%;
          }

          .cus-filter .field {
            width: 100%;
          }

          .cus-filter .field input,
          .cus-filter .field select {
            width: 100%;
          }
        }
      `}</style>
    </section>
  )
}
