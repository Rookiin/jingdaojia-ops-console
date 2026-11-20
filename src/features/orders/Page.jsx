import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store.js'
import { createOrder, transitionOrder } from '../../store/actions.js'
import { selectOrderDetail } from '../../store/selectors.js'
import {
  Badge,
  Card,
  FilterBar,
  Money,
  Pagination,
  StatTile,
  StatusBadge,
  Table,
} from '../../components/ui.jsx'
import {
  fmtDateTime,
  fmtNumber,
  periodLabel,
  toPct,
  truncate,
} from '../../lib/format.js'
import { makeIdempotencyKey, makeOrderNo } from '../../lib/id.js'
import { ORDER_STATUS, ORDER_TRANSITIONS, SERVICE_TYPES } from '../../domain/types.js'
import { periodOf } from '../../domain/period.js'

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

const PAGE_SIZE = 20
const DONE_STATUS = new Set(['completed', 'closed'])
const EMPTY_FILTERS = {
  district: '',
  status: '',
  service: '',
  keyword: '',
  reworkOnly: false,
}

const ORDER_STATUS_CN = {
  created: '已创建',
  assigned: '已派单',
  checked_in: '已签到',
  completed: '已完成',
  closed: '已关闭',
  cancelled: '已取消',
  voided: '已作废',
}

const SERVICE_TYPE_CN = {
  daily: '日常保洁',
  deep: '深度保洁',
  opening: '开荒玻璃',
}

const SERVICE_TONE = {
  daily: 'neutral',
  deep: 'info',
  opening: 'accent',
}

const TRANSITION_ACTION = {
  assigned: '派单',
  checked_in: '签到',
  completed: '完成',
  closed: '关闭',
  cancelled: '取消',
  voided: '作废',
}

const COMPLAINT_CATEGORY_CN = {
  damage: '物品损伤',
  late: '迟到',
  quality: '质量',
  attitude: '态度',
  other: '其他',
}

const COMPLAINT_CHANNEL_CN = {
  phone: '电话',
  wechat: '微信',
  app: 'App',
}

const COMPLAINT_STATUS_CN = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

const COMPENSATION_REASON_CN = {
  wash_damage: '水洗损伤',
  scratch: '刮花',
  lost: '遗失',
  other: '其他',
}

const IDLE_TYPE_CN = {
  idle: '空跑',
  reschedule: '改约',
}

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function minutesBetween(startAt, endAt) {
  const start = Date.parse(startAt)
  const end = Date.parse(endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.round((end - start) / 60000)
}

/** 现有工单最大序号 + 1；id 用 O-<6 位>，单号用 makeOrderNo(period, seq)。 */
function nextOrderIdentity(orders) {
  let max = 0
  for (const order of asArray(orders)) {
    const idMatch = /^O-(\d+)$/.exec(order?.id || '')
    if (idMatch) max = Math.max(max, Number(idMatch[1]))
    const noMatch = /^NJ\d{6}(\d{4})$/.exec(order?.order_no || '')
    if (noMatch) max = Math.max(max, Number(noMatch[1]))
  }
  const seq = max + 1
  return { seq, id: `O-${String(seq).padStart(6, '0')}` }
}

/** datetime-local 默认值（Asia/Shanghai 当天 09:00）。 */
function defaultScheduledLocal() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (type) => parts.find((part) => part.type === type)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')}T09:00`
  } catch {
    return ''
  }
}

/** datetime-local 字符串 → ISO8601 +08:00；非法返回 null。 */
function localInputToIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(value || ''),
  )
  if (!match) return null
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${
    match[6] || '00'
  }+08:00`
  return Number.isFinite(Date.parse(iso)) ? iso : null
}

function isEvidenceComplete(order) {
  return (
    asArray(order?.photos_before).length >= 1 &&
    asArray(order?.photos_after).length >= 1 &&
    Boolean(order?.signature)
  )
}

/* -------------------------------------------------------------------------- */
/* 小部件                                                                      */
/* -------------------------------------------------------------------------- */

function TimelineNode({ label, at, prevAt, missingLabel }) {
  const gap = prevAt && at ? minutesBetween(prevAt, at) : null
  return (
    <li className={`ord-timeline-item${at ? '' : ' is-missing'}`}>
      <span className="ord-timeline-dot" aria-hidden="true" />
      <div className="ord-timeline-label">{label}</div>
      <div className="ord-timeline-time">{at ? fmtDateTime(at) : missingLabel || '未发生'}</div>
      {gap !== null && (
        <div className="ord-timeline-gap">
          {gap === 0
            ? '与上一节点同一时刻'
            : gap > 0
              ? `距上一节点 ${fmtNumber(gap)} 分钟`
              : `早于上一节点 ${fmtNumber(-gap)} 分钟`}
        </div>
      )}
    </li>
  )
}

function EvidenceBadges({ order }) {
  const before = asArray(order.photos_before).length
  const after = asArray(order.photos_after).length
  return (
    <div className="ord-evidence-badges">
      <Badge tone={before > 0 ? 'success' : 'warning'}>前照片 {before > 0 ? before : '无'}</Badge>
      <Badge tone={after > 0 ? 'success' : 'warning'}>后照片 {after > 0 ? after : '无'}</Badge>
      <Badge tone={order.signature ? 'success' : 'warning'}>
        签字 {order.signature ? '✓' : '缺'}
      </Badge>
    </div>
  )
}

function RefChips({ label, refs, emptyText }) {
  const list = asArray(refs)
  return (
    <div className="ord-evidence-group">
      <div className="ord-group-label">
        {label}（{list.length}）
      </div>
      {list.length > 0 ? (
        <div className="ord-chips">
          {list.map((ref) => (
            <code className="ord-chip" key={ref}>
              {ref}
            </code>
          ))}
        </div>
      ) : (
        <p className="ord-empty-line">{emptyText}</p>
      )}
    </div>
  )
}

function ResultBanner({ result }) {
  if (!result) return null
  return (
    <div
      className={`ord-result ${result.ok ? 'is-ok' : 'is-error'}`}
      role="status"
    >
      {result.ok ? (
        result.message
      ) : (
        <>
          <code>{result.code}</code> · {result.message}
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export default function OrdersPage() {
  const state = useStore((s) => s)
  const orders = asArray(state.orders)
  const districts = asArray(state.districts)
  const cleaners = asArray(state.cleaners)
  const period = state.meta?.period || '—'

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS })
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [createResult, setCreateResult] = useState(null)
  const [transitionResult, setTransitionResult] = useState(null)

  const [form, setForm] = useState(() => ({
    districtId:
      asArray(state.districts).find((district) => district.is_pilot)?.id ||
      asArray(state.districts)[0]?.id ||
      '',
    customerId: '',
    cleanerId: '',
    serviceType: 'daily',
    amountYuan: '150',
    scheduledLocal: defaultScheduledLocal(),
    withEvidence: true,
  }))

  const detailRef = useRef(null)

  /* ----------------------------- 查找表 ---------------------------------- */

  const customerById = useMemo(
    () => new Map(asArray(state.customers).map((customer) => [customer.id, customer])),
    [state.customers],
  )
  const cleanerById = useMemo(
    () => new Map(asArray(state.cleaners).map((cleaner) => [cleaner.id, cleaner])),
    [state.cleaners],
  )
  const districtById = useMemo(
    () => new Map(asArray(state.districts).map((district) => [district.id, district])),
    [state.districts],
  )
  const complaintOrderIds = useMemo(
    () =>
      new Set(
        asArray(state.complaints)
          .map((complaint) => complaint.order_id)
          .filter(Boolean),
      ),
    [state.complaints],
  )

  /* ----------------------------- KPI ------------------------------------- */

  const kpis = useMemo(() => {
    const scoped = orders.filter((order) => periodOf(order.scheduled_at) === period)
    const doneOrders = scoped.filter((order) => DONE_STATUS.has(order.status))
    const evidenceComplete = doneOrders.filter(isEvidenceComplete).length
    return {
      total: scoped.length,
      done: doneOrders.length,
      completion: scoped.length > 0 ? doneOrders.length / scoped.length : null,
      rework: scoped.filter((order) => order.is_rework).length,
      complaintOrders: scoped.filter((order) => complaintOrderIds.has(order.id)).length,
      evidenceComplete,
      evidenceRate:
        doneOrders.length > 0 ? evidenceComplete / doneOrders.length : null,
    }
  }, [orders, period, complaintOrderIds])

  /* ----------------------------- 筛选 ------------------------------------ */

  const filtered = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase()
    return orders.filter((order) => {
      if (filters.district && order.district_id !== filters.district) return false
      if (filters.status && order.status !== filters.status) return false
      if (filters.service && order.service_type !== filters.service) return false
      if (filters.reworkOnly && !order.is_rework) return false
      if (keyword) {
        const customer = customerById.get(order.customer_id)
        const cleaner = cleanerById.get(order.cleaner_id)
        const haystack = [
          order.order_no,
          order.id,
          customer?.name,
          cleaner?.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }, [orders, filters, customerById, cleanerById])

  useEffect(() => {
    setPage(1)
  }, [filters])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  /* ----------------------------- 详情 ------------------------------------ */

  const detail = useMemo(
    () => (selectedId ? selectOrderDetail(state, selectedId) : null),
    [state, selectedId],
  )

  useEffect(() => {
    setTransitionResult(null)
  }, [selectedId])

  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedId])

  /* ----------------------------- 新建工单 -------------------------------- */

  const orderPeriod = /^\d{4}-\d{2}$/.test(period)
    ? period
    : periodOf(new Date().toISOString())
  const preview = useMemo(() => nextOrderIdentity(orders), [orders])
  const previewOrderNo = makeOrderNo(orderPeriod, preview.seq)
  const previewKey = makeIdempotencyKey('create', [preview.id])

  const customerEcho = useMemo(() => {
    const raw = form.customerId.trim()
    if (!raw) return { status: 'empty', raw }
    const customer = customerById.get(raw)
    return customer
      ? { status: 'ok', raw, customer }
      : { status: 'missing', raw }
  }, [form.customerId, customerById])

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSelectRow(row) {
    setSelectedId(row.id)
  }

  function handleResetFilters() {
    setFilters({ ...EMPTY_FILTERS })
    setPage(1)
  }

  function handleCreate(event) {
    event.preventDefault()
    const errors = []

    const district = districtById.get(form.districtId)
    const rawCustomerId = form.customerId.trim()
    const customer = customerById.get(rawCustomerId)
    const cleaner = cleanerById.get(form.cleanerId)
    const amountText = String(form.amountYuan).trim()
    const amountCents =
      amountText === '' ? Number.NaN : Math.round(Number(amountText) * 100)
    const scheduledAt = localInputToIso(form.scheduledLocal)

    if (!district) errors.push('请选择片区')
    if (!rawCustomerId) errors.push('请填写客户 ID')
    else if (!customer) errors.push(`客户 ${rawCustomerId} 不存在`)
    if (!cleaner) errors.push('请选择阿姨')
    if (!SERVICE_TYPES.includes(form.serviceType)) errors.push('服务类型无效')
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      errors.push('金额需为正数（元）')
    }
    if (!scheduledAt) errors.push('请选择有效的预约时间')

    if (errors.length > 0) {
      setCreateResult({
        ok: false,
        code: 'INVALID_INPUT',
        message: errors.join('；'),
      })
      return
    }

    const identity = nextOrderIdentity(asArray(state.orders))
    const orderNo = makeOrderNo(orderPeriod, identity.seq)
    const nowIso = new Date().toISOString()
    const evidence = form.withEvidence
      ? {
          photos_before: [`mock://b/${identity.id}`],
          photos_after: [`mock://a/${identity.id}`],
          signature: `sig://${identity.id}`,
        }
      : { photos_before: [], photos_after: [], signature: null }

    const result = createOrder({
      id: identity.id,
      order_no: orderNo,
      district_id: district.id,
      customer_id: customer.id,
      cleaner_id: cleaner.id,
      service_type: form.serviceType,
      amount: amountCents,
      status: 'created',
      scheduled_at: scheduledAt,
      checkin_at: null,
      completed_at: null,
      ...evidence,
      is_rework: false,
      rework_of_order_id: null,
      cancel_reason: null,
      idempotency_key: makeIdempotencyKey('create', [identity.id]),
      created_by: 'DISPATCH-DEMO',
      created_at: nowIso,
      updated_at: nowIso,
    })

    if (result.ok) {
      setFilters({ ...EMPTY_FILTERS })
      setPage(1)
      setFormOpen(false)
      setSelectedId(result.data.id)
      setCreateResult({
        ok: true,
        message: `返回 ok · 已创建 ${result.data.order_no}（${result.data.id}）${
          result.duplicate ? '，幂等键命中，未重复创建' : ''
        }`,
      })
    } else {
      setCreateResult({ ok: false, code: result.code, message: result.message })
    }
  }

  function handleTransition(nextStatus) {
    if (!detail) return
    const result = transitionOrder(detail.order.id, nextStatus, {
      at: new Date().toISOString(),
    })
    if (result.ok) {
      setTransitionResult({
        ok: true,
        message: `返回 ok · ${result.data.order_no} 已流转为「${
          ORDER_STATUS_CN[nextStatus] || nextStatus
        }」${result.idempotent ? '（幂等重复操作，状态未变化）' : ''}。`,
      })
    } else {
      setTransitionResult({
        ok: false,
        code: result.code,
        message: result.message,
      })
    }
  }

  /* ----------------------------- 表格列 ---------------------------------- */

  const columns = [
    {
      key: 'order_no',
      title: '工单号',
      width: '136px',
      render: (row) => (
        <div>
          <div className="ord-order-no">
            {selectedId === row.id && (
              <span className="ord-row-selected ord-sel-dot" aria-hidden="true" />
            )}
            {row.order_no}
          </div>
          <span className="ord-sub">ID {row.id}</span>
        </div>
      ),
    },
    {
      key: 'district',
      title: '片区',
      render: (row) => {
        const district = districtById.get(row.district_id)
        return (
          <div>
            <div>{district?.name || row.district_id}</div>
            <span className="ord-sub">{row.district_id}</span>
          </div>
        )
      },
    },
    {
      key: 'customer',
      title: '客户',
      render: (row) => {
        const customer = customerById.get(row.customer_id)
        return (
          <div>
            <div>{customer?.name || '未知客户'}</div>
            <span className="ord-sub">{row.customer_id}</span>
          </div>
        )
      },
    },
    {
      key: 'cleaner',
      title: '阿姨',
      render: (row) => {
        const cleaner = cleanerById.get(row.cleaner_id)
        return (
          <div>
            <div>{cleaner?.name || '未派单'}</div>
            <span className="ord-sub">{row.cleaner_id || '—'}</span>
          </div>
        )
      },
    },
    {
      key: 'service_type',
      title: '服务类型',
      render: (row) => (
        <Badge tone={SERVICE_TONE[row.service_type] || 'neutral'}>
          {SERVICE_TYPE_CN[row.service_type] || row.service_type}
        </Badge>
      ),
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
      key: 'scheduled_at',
      title: '预约时间',
      render: (row) => <span className="ord-nowrap">{fmtDateTime(row.scheduled_at)}</span>,
    },
    {
      key: 'completed_at',
      title: '完成时间',
      render: (row) => (
        <span className="ord-nowrap">{row.completed_at ? fmtDateTime(row.completed_at) : '—'}</span>
      ),
    },
    {
      key: 'evidence',
      title: '证据标记',
      render: (row) => <EvidenceBadges order={row} />,
    },
  ]

  /* ----------------------------- 详情派生 -------------------------------- */

  const order = detail?.order
  const evidenceOk = order ? isEvidenceComplete(order) : false
  const nextStatuses = order ? ORDER_TRANSITIONS[order.status] || [] : []
  const photosBefore = order ? asArray(order.photos_before) : []
  const photosAfter = order ? asArray(order.photos_after) : []
  const selectedOrder = selectedId ? orders.find((item) => item.id === selectedId) : null

  return (
    <section className="page">
      <style>{`
        .ord-conclusion .card-body { padding: 13px 18px; }
        .ord-conclusion-inner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .ord-conclusion-inner p { margin: 0; flex: 1 1 440px; font-size: 13px; line-height: 1.6; color: var(--text-2); }
        .ord-conclusion-meta { font-size: 12px; color: var(--muted); white-space: nowrap; }

        .ord-keyword input { min-width: 230px; }
        .ord-filter-count { font-size: 12px; color: var(--muted); }

        .ord-order-no { display: flex; align-items: center; white-space: nowrap; font-weight: 600; }
        .ord-sel-dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
        .ord-sub { display: block; margin-top: 1px; font-size: 11px; color: var(--muted); }
        .ord-nowrap { white-space: nowrap; }
        .ord-evidence-badges { display: flex; gap: 4px; flex-wrap: wrap; }
        .ord-evidence-badges .badge { padding: 1px 6px; }

        .ord-orders-table tbody tr:has(.ord-row-selected) { background: var(--accent-soft); }
        .ord-orders-table tbody tr:has(.ord-row-selected) td { border-top-color: rgba(15, 118, 110, 0.25); }
        .ord-orders-table tbody tr:has(.ord-row-selected):hover { background: var(--accent-soft); }

        .ord-detail-grid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 22px; }
        .ord-section { min-width: 0; }
        .ord-section + .ord-section { margin-top: 18px; }
        .ord-section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .ord-section-title { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--text-2); }
        .ord-section-head .ord-section-title { margin-bottom: 0; }

        .ord-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 9px 14px; margin: 0; }
        .ord-kv > div { min-width: 0; }
        .ord-kv dt { font-size: 11px; color: var(--muted); }
        .ord-kv dd { margin: 2px 0 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }

        .ord-timeline { list-style: none; margin: 0; padding: 0 0 0 4px; }
        .ord-timeline-item { position: relative; margin-left: 4px; padding: 0 0 15px 20px; border-left: 2px solid var(--border); }
        .ord-timeline-item:last-child { padding-bottom: 0; border-left-color: transparent; }
        .ord-timeline-dot { position: absolute; left: -6px; top: 3px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); border: 2px solid var(--surface); box-shadow: 0 0 0 2px var(--accent-soft); }
        .ord-timeline-item.is-missing .ord-timeline-dot { background: var(--border-strong); box-shadow: none; }
        .ord-timeline-label { font-size: 12px; font-weight: 600; color: var(--text-2); }
        .ord-timeline-time { margin-top: 1px; font-size: 12px; color: var(--text); font-variant-numeric: tabular-nums; }
        .ord-timeline-gap { margin-top: 2px; font-size: 11px; color: var(--muted); }

        .ord-evidence-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .ord-evidence-box { flex: 1 1 96px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
        .ord-evidence-box b { display: block; font-size: 16px; font-variant-numeric: tabular-nums; }
        .ord-evidence-box span { font-size: 11px; color: var(--muted); }
        .ord-evidence-group + .ord-evidence-group { margin-top: 10px; }
        .ord-group-label { margin: 0 0 5px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); }
        .ord-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .ord-chip { padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-3); color: var(--text-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
        .ord-empty-line { margin: 4px 0 0; font-size: 12px; color: var(--muted); }

        .ord-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .ord-note { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: var(--muted); }
        .ord-note-warn { color: var(--warning); }
        .ord-result { margin-top: 10px; padding: 8px 10px; border-radius: var(--radius-sm); font-size: 12px; line-height: 1.6; }
        .ord-result code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 600; }
        .ord-result.is-ok { background: var(--success-soft); color: var(--success); }
        .ord-result.is-error { background: var(--danger-soft); color: var(--danger); }

        .ord-related { display: flex; flex-direction: column; gap: 8px; }
        .ord-related-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
        .ord-related-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 12px; }
        .ord-related-id { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 600; color: var(--text); }
        .ord-related-meta { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
        .ord-related-amount { margin-left: auto; }
        .ord-link { padding: 0; border: 0; background: transparent; color: var(--accent); font-size: 11px; cursor: pointer; text-decoration: underline; }
        .ord-link:hover { color: var(--accent-strong); }

        .ord-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px 14px; align-items: start; }
        .ord-form-grid .field { width: 100%; }
        .ord-form-grid .field input,
        .ord-form-grid .field select { width: 100%; }
        .ord-echo { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .ord-echo .ord-group-label { margin-bottom: 2px; }
        .ord-echo-ok { font-size: 12px; color: var(--success); overflow-wrap: anywhere; }
        .ord-echo-warn { font-size: 11px; color: var(--warning); }
        .ord-echo-error { font-size: 12px; color: var(--danger); }
        .ord-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); align-self: end; padding-bottom: 7px; }
        .ord-form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
        .ord-form-note { font-size: 11px; color: var(--muted); }

        @media (max-width: 980px) {
          .ord-detail-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
        }
      `}</style>

      <header className="page-head">
        <div>
          <span className="page-code">M1</span>
          <h1>工单追溯</h1>
          <p className="muted">工单列表、新建派单、时间线、证据链与状态流转</p>
        </div>
        <div className="row">
          <Badge tone="accent">账期 {period}</Badge>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? '收起新建' : '新建工单'}
          </button>
        </div>
      </header>

      <Card className="ord-conclusion">
        <div className="ord-conclusion-inner">
          <Badge tone="accent">可追溯</Badge>
          <p>
            每单具备签到/完成时间、前后照片、客户签字，任一投诉可回溯到具体工单与阿姨。
          </p>
          <span className="ord-conclusion-meta">
            本期完成单证据完整率 {toPct(kpis.evidenceRate)}
          </span>
        </div>
      </Card>

      <div className="stat-grid">
        <StatTile
          label="账期工单数"
          value={fmtNumber(kpis.total)}
          hint={`预约时间在 ${periodLabel(period)}`}
          tone="accent"
        />
        <StatTile
          label="完成率"
          value={toPct(kpis.completion)}
          hint={`${fmtNumber(kpis.done)} / ${fmtNumber(kpis.total)} 已完单（完成+关闭）`}
          tone="success"
        />
        <StatTile
          label="返工单数"
          value={fmtNumber(kpis.rework)}
          hint="按 is_rework 标记统计"
          tone={kpis.rework > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="有关联投诉的工单"
          value={fmtNumber(kpis.complaintOrders)}
          hint="投诉 order_id 可定位到具体工单"
          tone={kpis.complaintOrders > 0 ? 'danger' : 'neutral'}
        />
        <StatTile
          label="证据完整率"
          value={toPct(kpis.evidenceRate)}
          hint={`${fmtNumber(kpis.evidenceComplete)} / ${fmtNumber(kpis.done)} 完成单前后照片+签字齐全`}
          tone="info"
        />
      </div>

      <Card
        title="新建工单"
        subtitle={`将生成 ${previewOrderNo} · ${preview.id} · 初始状态「已创建」`}
        actions={
          <button type="button" className="btn" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? '收起表单' : '展开表单'}
          </button>
        }
        footer={<ResultBanner result={createResult} />}
      >
        {formOpen ? (
          <form className="ord-form" onSubmit={handleCreate} noValidate>
            <div className="ord-form-grid">
              <label className="field">
                片区
                <select
                  value={form.districtId}
                  onChange={(event) => updateForm('districtId', event.target.value)}
                >
                  <option value="">请选择片区</option>
                  {districts.map((district) => (
                    <option key={district.id} value={district.id}>
                      {district.name}
                      {district.status === 'config_only' ? '（未开城）' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                客户 ID
                <input
                  type="text"
                  value={form.customerId}
                  placeholder="例如 K-0001"
                  autoComplete="off"
                  onChange={(event) => updateForm('customerId', event.target.value)}
                />
              </label>

              <div className="ord-echo">
                <span className="ord-group-label">客户回显校验</span>
                {customerEcho.status === 'empty' && (
                  <span className="ord-empty-line">输入客户 ID 后回显姓名 / 电话 / 归属片区</span>
                )}
                {customerEcho.status === 'missing' && (
                  <span className="ord-echo-error">未找到客户“{customerEcho.raw}”</span>
                )}
                {customerEcho.status === 'ok' && (
                  <>
                    <span className="ord-echo-ok">
                      {customerEcho.customer.name} · {customerEcho.customer.phone_masked} ·{' '}
                      {districtById.get(customerEcho.customer.district_id)?.name ||
                        customerEcho.customer.district_id}
                    </span>
                    {form.districtId &&
                      customerEcho.customer.district_id !== form.districtId && (
                        <span className="ord-echo-warn">
                          客户归属片区与所选片区不一致（不阻断创建）
                        </span>
                      )}
                  </>
                )}
              </div>

              <label className="field">
                阿姨
                <select
                  value={form.cleanerId}
                  onChange={(event) => updateForm('cleanerId', event.target.value)}
                >
                  <option value="">请选择阿姨</option>
                  {cleaners.map((cleaner) => (
                    <option key={cleaner.id} value={cleaner.id}>
                      {cleaner.id} {cleaner.name} ·{' '}
                      {districtById.get(cleaner.district_id)?.name || cleaner.district_id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                服务类型
                <select
                  value={form.serviceType}
                  onChange={(event) => updateForm('serviceType', event.target.value)}
                >
                  {SERVICE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SERVICE_TYPE_CN[type]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                金额（元）
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={form.amountYuan}
                  onChange={(event) => updateForm('amountYuan', event.target.value)}
                />
              </label>

              <label className="field">
                预约时间（Asia/Shanghai）
                <input
                  type="datetime-local"
                  value={form.scheduledLocal}
                  onChange={(event) => updateForm('scheduledLocal', event.target.value)}
                />
              </label>

              <label className="ord-check">
                <input
                  type="checkbox"
                  checked={form.withEvidence}
                  onChange={(event) => updateForm('withEvidence', event.target.checked)}
                />
                预置演示证据（前后照片 + 客户签字）
              </label>
            </div>

            <div className="ord-form-actions">
              <button type="submit" className="btn btn-primary">
                创建工单
              </button>
              <button type="button" className="btn" onClick={() => setFormOpen(false)}>
                取消
              </button>
              <span className="ord-form-note">
                幂等键 {previewKey} · 金额 Math.round(元 × 100) 转分 ·
                预约时间转 +08:00 ISO
              </span>
            </div>
          </form>
        ) : (
          <p className="ord-empty-line">
            表单已收起；点击右上角「展开表单」或页面右上角「新建工单」开始录入。
          </p>
        )}
      </Card>

      <FilterBar
        actions={
          <>
            <span className="ord-filter-count">
              筛选结果 {fmtNumber(filtered.length)} 条
            </span>
            <button type="button" className="btn" onClick={handleResetFilters}>
              重置筛选
            </button>
          </>
        }
      >
        <label className="field">
          片区
          <select
            value={filters.district}
            onChange={(event) => setFilters((prev) => ({ ...prev, district: event.target.value }))}
          >
            <option value="">全部片区</option>
            {districts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          状态
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="">全部状态</option>
            {ORDER_STATUS.map((status) => (
              <option key={status} value={status}>
                {ORDER_STATUS_CN[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          服务类型
          <select
            value={filters.service}
            onChange={(event) => setFilters((prev) => ({ ...prev, service: event.target.value }))}
          >
            <option value="">全部类型</option>
            {SERVICE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SERVICE_TYPE_CN[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="field ord-keyword">
          关键词
          <input
            type="search"
            value={filters.keyword}
            placeholder="工单号 / 客户姓名 / 阿姨姓名"
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
          />
        </label>

        <label className="ord-check">
          <input
            type="checkbox"
            checked={filters.reworkOnly}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, reworkOnly: event.target.checked }))
            }
          />
          仅看返工
        </label>
      </FilterBar>

      <Card
        title="工单列表"
        subtitle={`共 ${fmtNumber(orders.length)} 条（含新建）· 每页 ${PAGE_SIZE} 条 · 点击行查看详情`}
        footer={
          selectedOrder
            ? `已选中 ${selectedOrder.order_no}，详情见下方「工单详情」。`
            : '点击任一行查看时间线、证据链、关联投诉/赔付/返工/空跑与状态流转。'
        }
      >
        <Table
          className="ord-orders-table"
          columns={columns}
          rows={pageRows}
          rowKey="id"
          onRowClick={handleSelectRow}
          empty="没有匹配的工单"
          emptyHint="调整片区、状态、服务类型或关键词后重试。"
          caption="工单列表"
        />
        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onChange={setPage}
        />
      </Card>

      {detail && order && (
        <div ref={detailRef}>
          <Card
            title={`工单详情 · ${order.order_no}`}
            subtitle={`${SERVICE_TYPE_CN[order.service_type] || order.service_type} · ${
              detail.district?.name || order.district_id
            } · 创建于 ${fmtDateTime(order.created_at)}`}
            actions={
              <>
                <Badge tone={evidenceOk ? 'success' : 'warning'}>
                  {evidenceOk ? '证据齐全' : '证据不完整'}
                </Badge>
                <StatusBadge status={order.status} />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSelectedId(null)}
                >
                  收起
                </button>
              </>
            }
          >
            <div className="ord-detail-grid">
              <div>
                <section className="ord-section">
                  <h3 className="ord-section-title">基本信息</h3>
                  <dl className="ord-kv">
                    <div>
                      <dt>工单号</dt>
                      <dd>{order.order_no}</dd>
                    </div>
                    <div>
                      <dt>内部 ID</dt>
                      <dd>{order.id}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>
                        <StatusBadge status={order.status} />
                      </dd>
                    </div>
                    <div>
                      <dt>服务类型</dt>
                      <dd>{SERVICE_TYPE_CN[order.service_type] || order.service_type}</dd>
                    </div>
                    <div>
                      <dt>金额</dt>
                      <dd>
                        <Money cents={order.amount} />
                      </dd>
                    </div>
                    <div>
                      <dt>片区</dt>
                      <dd>
                        {detail.district
                          ? `${detail.district.name}（${detail.district.id}）`
                          : order.district_id}
                      </dd>
                    </div>
                    <div>
                      <dt>客户</dt>
                      <dd>
                        {detail.customer
                          ? `${detail.customer.name}（${detail.customer.id}）`
                          : order.customer_id}
                        {detail.customer?.phone_masked && (
                          <span className="ord-sub">{detail.customer.phone_masked}</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>阿姨</dt>
                      <dd>
                        {detail.cleaner
                          ? `${detail.cleaner.name}（${detail.cleaner.id}）`
                          : order.cleaner_id || '未派单'}
                        {detail.cleaner && (
                          <span className="ord-sub">
                            {detail.cleaner.phone_masked} ·{' '}
                            {districtById.get(detail.cleaner.district_id)?.name ||
                              detail.cleaner.district_id}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>返工单</dt>
                      <dd>
                        {order.is_rework
                          ? `是${
                              order.rework_of_order_id
                                ? ` · 原单 ${order.rework_of_order_id}`
                                : ''
                            }`
                          : '否'}
                      </dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>{fmtDateTime(order.updated_at)}</dd>
                    </div>
                  </dl>
                  {order.cancel_reason && (
                    <p className="ord-note">取消原因：{order.cancel_reason}</p>
                  )}
                </section>

                <section className="ord-section">
                  <h3 className="ord-section-title">时间线</h3>
                  <ol className="ord-timeline">
                    <TimelineNode label="创建工单" at={order.created_at} />
                    <TimelineNode
                      label="预约上门"
                      at={order.scheduled_at}
                      prevAt={order.created_at}
                      missingLabel="未安排"
                    />
                    <TimelineNode
                      label="到岗签到"
                      at={order.checkin_at}
                      prevAt={order.scheduled_at || order.created_at}
                      missingLabel="未签到"
                    />
                    <TimelineNode
                      label="服务完成"
                      at={order.completed_at}
                      prevAt={
                        order.checkin_at || order.scheduled_at || order.created_at
                      }
                      missingLabel="未完成"
                    />
                  </ol>
                </section>
              </div>

              <div>
                <section className="ord-section">
                  <div className="ord-section-head">
                    <h3 className="ord-section-title">证据链</h3>
                    <Badge tone={evidenceOk ? 'success' : 'warning'}>
                      {evidenceOk ? '齐全' : '不完整'}
                    </Badge>
                  </div>
                  <div className="ord-evidence-stats">
                    <div className="ord-evidence-box">
                      <b>{photosBefore.length}</b>
                      <span>服务前照片</span>
                    </div>
                    <div className="ord-evidence-box">
                      <b>{photosAfter.length}</b>
                      <span>服务后照片</span>
                    </div>
                    <div className="ord-evidence-box">
                      <b>{order.signature ? '已签' : '缺失'}</b>
                      <span>客户签字</span>
                    </div>
                  </div>
                  <RefChips
                    label="photos_before"
                    refs={photosBefore}
                    emptyText="无服务前照片"
                  />
                  <RefChips
                    label="photos_after"
                    refs={photosAfter}
                    emptyText="无服务后照片"
                  />
                  <div className="ord-evidence-group">
                    <div className="ord-group-label">signature</div>
                    {order.signature ? (
                      <div className="ord-chips">
                        <code className="ord-chip">{order.signature}</code>
                      </div>
                    ) : (
                      <p className="ord-empty-line">客户签字缺失</p>
                    )}
                  </div>
                  {!evidenceOk && (
                    <p className="ord-note ord-note-warn">
                      证据不完整：完成工单需前后照片各 ≥1 张且客户签字非空。
                    </p>
                  )}
                </section>

                <section className="ord-section">
                  <h3 className="ord-section-title">状态流转</h3>
                  <div className="ord-actions-row">
                    {nextStatuses.length === 0 ? (
                      <span className="ord-empty-line">当前为终态，无可执行流转。</span>
                    ) : (
                      nextStatuses.map((nextStatus) => (
                        <button
                          key={nextStatus}
                          type="button"
                          className={`btn${nextStatus === 'completed' ? ' btn-primary' : ''}`}
                          onClick={() => handleTransition(nextStatus)}
                        >
                          {TRANSITION_ACTION[nextStatus] || nextStatus} →{' '}
                          {ORDER_STATUS_CN[nextStatus] || nextStatus}
                        </button>
                      ))
                    )}
                  </div>
                  {nextStatuses.includes('completed') && !order.signature && (
                    <p className="ord-note">
                      完成要求客户签字；当前签名为空，点击「完成」将返回 MISSING_SIGNATURE。
                    </p>
                  )}
                  <ResultBanner result={transitionResult} />
                </section>

                <section className="ord-section">
                  <h3 className="ord-section-title">关联记录</h3>
                  <div className="ord-related">
                    <div>
                      <div className="ord-group-label">
                        投诉（{detail.complaints.length}）
                      </div>
                      {detail.complaints.length === 0 ? (
                        <p className="ord-empty-line">无关联投诉</p>
                      ) : (
                        detail.complaints.map((complaint) => (
                          <div className="ord-related-row" key={complaint.id}>
                            <div className="ord-related-main">
                              <span className="ord-related-id">
                                {complaint.id}
                                <StatusBadge
                                  status={complaint.status}
                                  label={
                                    COMPLAINT_STATUS_CN[complaint.status] ||
                                    complaint.status
                                  }
                                />
                              </span>
                              <span className="ord-related-meta">
                                {COMPLAINT_CATEGORY_CN[complaint.category] ||
                                  complaint.category}{' '}
                                ·{' '}
                                {COMPLAINT_CHANNEL_CN[complaint.channel] ||
                                  complaint.channel}{' '}
                                · {fmtDateTime(complaint.created_at)}
                              </span>
                              <span className="ord-related-meta">
                                {truncate(complaint.content, 46)}
                              </span>
                              {complaint.compensation_id && (
                                <span className="ord-related-meta">
                                  关联赔付 {complaint.compensation_id}
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div>
                      <div className="ord-group-label">
                        赔付（{detail.compensations.length}）
                      </div>
                      {detail.compensations.length === 0 ? (
                        <p className="ord-empty-line">无关联赔付</p>
                      ) : (
                        detail.compensations.map((compensation) => (
                          <div className="ord-related-row" key={compensation.id}>
                            <div className="ord-related-main">
                              <span className="ord-related-id">
                                {compensation.id}
                                <StatusBadge status={compensation.status} />
                                <StatusBadge status={compensation.responsibility} />
                              </span>
                              <span className="ord-related-meta">
                                {COMPENSATION_REASON_CN[compensation.reason] ||
                                  compensation.reason}{' '}
                                · 证据评分 {fmtNumber(compensation.evidence_score)} · 审批{' '}
                                {fmtDateTime(compensation.approved_at)}
                              </span>
                            </div>
                            <span className="ord-related-amount">
                              <Money cents={compensation.amount} />
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div>
                      <div className="ord-group-label">
                        返工（{detail.reworks.length}）
                      </div>
                      {detail.reworks.length === 0 ? (
                        <p className="ord-empty-line">无关联返工</p>
                      ) : (
                        detail.reworks.map((rework) => (
                          <div className="ord-related-row" key={rework.id}>
                            <div className="ord-related-main">
                              <span className="ord-related-id">
                                {rework.id}
                                <span className="ord-related-meta">
                                  {fmtDateTime(rework.created_at)}
                                </span>
                              </span>
                              <span className="ord-related-meta">
                                原因：{rework.reason || '—'}
                              </span>
                              {rework.rework_order_id && (
                                <button
                                  type="button"
                                  className="ord-link"
                                  onClick={() => setSelectedId(rework.rework_order_id)}
                                >
                                  查看返工单 {rework.rework_order_id} →
                                </button>
                              )}
                            </div>
                            <span className="ord-related-amount">
                              <Money cents={rework.cost} />
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div>
                      <div className="ord-group-label">
                        空跑/改约（{detail.idleRuns.length}）
                      </div>
                      {detail.idleRuns.length === 0 ? (
                        <p className="ord-empty-line">无关联空跑或改约</p>
                      ) : (
                        detail.idleRuns.map((idleRun) => (
                          <div className="ord-related-row" key={idleRun.id}>
                            <div className="ord-related-main">
                              <span className="ord-related-id">
                                {idleRun.id}
                                <Badge tone="warning">
                                  {IDLE_TYPE_CN[idleRun.type] || idleRun.type}
                                </Badge>
                              </span>
                              <span className="ord-related-meta">
                                原因：{idleRun.reason || '—'} ·{' '}
                                {fmtDateTime(idleRun.created_at)}
                              </span>
                            </div>
                            <span className="ord-related-amount">
                              <Money cents={idleRun.cost} />
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </Card>
        </div>
      )}
    </section>
  )
}
