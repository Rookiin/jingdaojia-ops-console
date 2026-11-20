import { useMemo, useState } from 'react'
import { useStore } from '../../store.js'
import { selectOrderDetail, selectUndeterminedRate } from '../../store/selectors.js'
import { addCompensation, approveCompensation } from '../../store/actions.js'
import {
  calcCompensation,
  decideResponsibility,
} from '../../domain/responsibility.js'
import {
  COMPENSATION_REASONS,
  COMPENSATION_STATUS,
  RESPONSIBILITIES,
} from '../../domain/types.js'
import {
  Badge,
  BarChart,
  Card,
  EmptyState,
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
  fmtPct,
  formatYuan,
  toYuan,
} from '../../lib/format.js'

const PAGE_SIZE = 20

const REASON_LABELS = {
  wash_damage: '洗涤损伤',
  scratch: '划伤',
  lost: '物品遗失',
  other: '其他',
}

const RESP_LABELS = {
  cleaner: '阿姨',
  customer: '客户',
  product: '产品',
  none: '无责',
  undetermined: '待定',
}

const ROLE_LABELS = {
  district_manager: '片区经理',
  finance: '财务',
}

const STATUS_LABELS = {
  draft: '草稿',
  pending_approval: '待审批',
  approved: '已审批',
  rejected: '已驳回',
  reversed: '已红冲',
}

/* -------------------------------------------------------------------------- */
/* 纯工具                                                                      */
/* -------------------------------------------------------------------------- */

function toOrderEvidence(order) {
  return {
    id: order.id,
    checkinAt: order.checkin_at || null,
    completedAt: order.completed_at || null,
    photosBefore: Array.isArray(order.photos_before) ? order.photos_before : [],
    photosAfter: Array.isArray(order.photos_after) ? order.photos_after : [],
    signature: order.signature || null,
  }
}

function latestComplaintFrom(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  let latest = null
  for (const item of list) {
    if (!item || !item.created_at) continue
    if (!latest) {
      latest = item
      continue
    }
    const a = Date.parse(item.created_at)
    const b = Date.parse(latest.created_at)
    if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) latest = item
  }
  return latest
}

function latestComplaintForOrder(complaints, orderId) {
  const list = (complaints || []).filter((c) => c.order_id === orderId)
  return latestComplaintFrom(list)
}

function buildEvidenceRefs(order, complaint) {
  const refs = []
  const push = (value) => {
    if (value && !refs.includes(value)) refs.push(value)
  }
  for (const ref of order.photos_before || []) push(ref)
  for (const ref of order.photos_after || []) push(ref)
  if (order.signature) push(order.signature)
  if (complaint && complaint.id) push(`mock://complaint/${complaint.id}`)
  return refs
}

function nextCompensationId(list) {
  let max = 0
  for (const comp of list || []) {
    const matched = /^CMP-(\d+)$/.exec(comp.id || '')
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `CMP-${String(max + 1).padStart(4, '0')}`
}

function parseYuanToCents(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const yuan = Number(raw)
  if (!Number.isFinite(yuan) || yuan <= 0) return null
  const cents = Math.round(yuan * 100)
  return cents > 0 ? cents : null
}

function sumAmount(list) {
  let total = 0
  for (const item of list) total += Number(item.amount) || 0
  return total
}

function buildDistribution(list, keys, labels, getKey) {
  return keys.map((key) => {
    const subset = list.filter((item) => getKey(item) === key)
    return {
      key,
      label: labels[key] || key,
      count: subset.length,
      amount: sumAmount(subset),
    }
  })
}

function chartData(rows, mode) {
  return rows.map((row) => ({
    label: row.label,
    value: mode === 'amount' ? row.amount : row.count,
  }))
}

function msgClass(kind) {
  if (kind === 'ok') return 'is-ok'
  if (kind === 'dup') return 'is-dup'
  return 'is-error'
}

/* -------------------------------------------------------------------------- */
/* 小组件                                                                      */
/* -------------------------------------------------------------------------- */

function ResultPanel({ result }) {
  if (!result) return null
  return (
    <div className="cmp-result">
      <div className="cmp-result-head">
        <StatusBadge
          status={result.responsibility}
          label={RESP_LABELS[result.responsibility] || result.responsibility}
        />
        <span>
          证据分 <b>{Number.isFinite(result.evidenceScore) ? result.evidenceScore : 0}</b>
        </span>
        <Badge tone={result.requiresManualReview ? 'warning' : 'success'}>
          {result.requiresManualReview ? '需人工复核' : '无需复核'}
        </Badge>
        <Badge tone={result.maxApprovalRole === 'finance' ? 'danger' : 'info'}>
          终审：{ROLE_LABELS[result.maxApprovalRole] || result.maxApprovalRole}
        </Badge>
      </div>
      <ul className="cmp-reasons">
        {(result.reasons || []).map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </div>
  )
}

function EvidenceRefs({ title, refs }) {
  return (
    <div className="cmp-evidence">
      <span>
        {title} <b>{(refs || []).length} 张</b>
      </span>
      <div className="cmp-ref-list">
        {(refs || []).length > 0 ? (
          refs.map((ref) => (
            <code className="cmp-ref" key={ref}>
              {ref}
            </code>
          ))
        ) : (
          <span className="muted">无</span>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export default function CompensationsPage() {
  const state = useStore((s) => s)

  /* 列表筛选 */
  const [statusFilter, setStatusFilter] = useState('all')
  const [respFilter, setRespFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)

  /* 选中详情 */
  const [selectedId, setSelectedId] = useState(null)
  const [autoHasPrePhoto, setAutoHasPrePhoto] = useState(false)
  const [autoProductDefect, setAutoProductDefect] = useState(false)
  const [autoResult, setAutoResult] = useState(null)
  const [autoError, setAutoError] = useState('')
  const [manualResp, setManualResp] = useState('cleaner')
  const [manualReason, setManualReason] = useState('')
  const [manualResult, setManualResult] = useState(null)
  const [manualMsg, setManualMsg] = useState(null)
  const [approvalMsg, setApprovalMsg] = useState(null)

  /* 图表模式 */
  const [respMode, setRespMode] = useState('count')
  const [reasonMode, setReasonMode] = useState('count')

  /* 新建赔付 */
  const [createQuery, setCreateQuery] = useState('')
  const [createOrderId, setCreateOrderId] = useState('')
  const [createReason, setCreateReason] = useState('other')
  const [createAmount, setCreateAmount] = useState('')
  const [createHasPrePhoto, setCreateHasPrePhoto] = useState(false)
  const [createProductDefect, setCreateProductDefect] = useState(false)
  const [createEval, setCreateEval] = useState(null)
  const [createMsg, setCreateMsg] = useState(null)
  const [lastSubmit, setLastSubmit] = useState(null)

  const compensations = state.compensations || []

  const orderMap = useMemo(
    () => new Map((state.orders || []).map((order) => [order.id, order])),
    [state.orders],
  )
  const districtMap = useMemo(
    () => new Map((state.districts || []).map((district) => [district.id, district])),
    [state.districts],
  )
  const cleanerMap = useMemo(
    () => new Map((state.cleaners || []).map((cleaner) => [cleaner.id, cleaner])),
    [state.cleaners],
  )

  /* ---------------------------------------------------------------------- */
  /* KPI                                                                     */
  /* ---------------------------------------------------------------------- */
  const kpis = useMemo(() => {
    let approvedTotal = 0
    let approvedCount = 0
    let pendingTotal = 0
    let pendingCount = 0
    let scoreSum = 0
    let scoreCount = 0
    for (const comp of compensations) {
      const amount = Number(comp.amount) || 0
      if (comp.status === 'approved') {
        approvedTotal += amount
        approvedCount += 1
      }
      if (comp.status === 'pending_approval') {
        pendingTotal += amount
        pendingCount += 1
      }
      const score = Number(comp.evidence_score)
      if (Number.isFinite(score)) {
        scoreSum += score
        scoreCount += 1
      }
    }
    return {
      total: compensations.length,
      approvedTotal,
      approvedCount,
      pendingTotal,
      pendingCount,
      avgScore: scoreCount === 0 ? null : scoreSum / scoreCount,
    }
  }, [compensations])

  const undetermined = useMemo(() => selectUndeterminedRate(state), [state])

  /* ---------------------------------------------------------------------- */
  /* 分布                                                                    */
  /* ---------------------------------------------------------------------- */
  const distributions = useMemo(() => {
    const responsibility = buildDistribution(
      compensations,
      RESPONSIBILITIES,
      RESP_LABELS,
      (comp) => comp.responsibility,
    )
    const reason = buildDistribution(
      compensations,
      COMPENSATION_REASONS,
      REASON_LABELS,
      (comp) => comp.reason,
    )
    return { responsibility, reason }
  }, [compensations])

  /* ---------------------------------------------------------------------- */
  /* 列表                                                                    */
  /* ---------------------------------------------------------------------- */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return compensations.filter((comp) => {
      if (statusFilter !== 'all' && comp.status !== statusFilter) return false
      if (respFilter !== 'all' && comp.responsibility !== respFilter) return false
      if (reasonFilter !== 'all' && comp.reason !== reasonFilter) return false
      if (kw) {
        const orderNo = orderMap.get(comp.order_id)?.order_no || ''
        const haystack = `${comp.id} ${orderNo}`.toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })
  }, [compensations, orderMap, statusFilter, respFilter, reasonFilter, keyword])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  /* ---------------------------------------------------------------------- */
  /* 选中赔付 + 关联工单                                                     */
  /* ---------------------------------------------------------------------- */
  const selectedComp = useMemo(
    () => compensations.find((comp) => comp.id === selectedId) || null,
    [compensations, selectedId],
  )

  const orderDetail = useMemo(
    () => (selectedComp ? selectOrderDetail(state, selectedComp.order_id) : null),
    [state, selectedComp],
  )

  const latestComplaint = useMemo(
    () => latestComplaintFrom(orderDetail?.complaints),
    [orderDetail],
  )

  const priorSameTypeCount = useMemo(() => {
    if (!selectedComp || !orderDetail?.order) return 0
    const cleanerId = orderDetail.order.cleaner_id
    return compensations.filter((comp) => {
      if (comp.id === selectedComp.id) return false
      if (comp.reason !== selectedComp.reason) return false
      if (comp.status !== 'approved') return false
      const order = orderMap.get(comp.order_id)
      return order && order.cleaner_id === cleanerId
    }).length
  }, [compensations, selectedComp, orderDetail, orderMap])

  const compensationAdvice = useMemo(() => {
    if (!selectedComp) return null
    try {
      return calcCompensation({
        claimAmount: Number(selectedComp.amount) || 0,
        responsibility: selectedComp.responsibility,
      })
    } catch {
      return null
    }
  }, [selectedComp])

  function selectComp(id) {
    setSelectedId(id)
    setAutoResult(null)
    setAutoError('')
    setAutoHasPrePhoto(false)
    setAutoProductDefect(false)
    setManualResp('cleaner')
    setManualReason('')
    setManualResult(null)
    setManualMsg(null)
    setApprovalMsg(null)
  }

  function resetFilters() {
    setStatusFilter('all')
    setRespFilter('all')
    setReasonFilter('all')
    setKeyword('')
    setPage(1)
  }

  /* ---------------------------------------------------------------------- */
  /* 自动评估 / 人工定责                                                     */
  /* ---------------------------------------------------------------------- */
  function selectedResponsibilityInput(source, extra) {
    const order = orderDetail?.order
    if (!order || !selectedComp) return null
    return {
      order: toOrderEvidence(order),
      complaintAt: latestComplaint?.created_at || '',
      claimAmount: Number(selectedComp.amount) || 0,
      hasCustomerPrePhoto: autoHasPrePhoto,
      productDefectEvidence: autoProductDefect,
      priorSameTypeCount,
      source,
      ...extra,
    }
  }

  function handleAutoEvaluate() {
    const input = selectedResponsibilityInput('auto')
    if (!input) {
      setAutoError('缺少关联工单，无法自动评估')
      return
    }
    try {
      const result = decideResponsibility(input)
      setAutoResult(result)
      setAutoError('')
    } catch (error) {
      setAutoResult(null)
      setAutoError(error?.message || '自动评估失败')
    }
  }

  function handleManualDecide() {
    if (!manualReason.trim()) {
      setManualResult(null)
      setManualMsg({
        kind: 'error',
        text: '人工定责必须填写理由；“无责”只能由人工路径产生。',
      })
      return
    }
    const input = selectedResponsibilityInput('manual', {
      manualResponsibility: manualResp,
      manualReason: manualReason.trim(),
    })
    if (!input) {
      setManualMsg({ kind: 'error', text: '缺少关联工单或赔付金额，无法定责' })
      return
    }
    try {
      const result = decideResponsibility(input)
      setManualResult(result)
      setManualMsg({
        kind: 'ok',
        text: '人工定责完成。真实系统会以 version+1 落库并保留理由与审批留痕；本演示仅展示判定结果，入账仍需审批。',
      })
    } catch (error) {
      setManualResult(null)
      setManualMsg({ kind: 'error', text: error?.message || '人工定责失败' })
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 审批                                                                    */
  /* ---------------------------------------------------------------------- */
  const canApprove =
    Boolean(selectedComp) &&
    (selectedComp.status === 'pending_approval' || selectedComp.status === 'draft')

  function handleApprove() {
    if (!selectedComp) return
    if (!(Number(selectedComp.amount) > 0)) {
      setApprovalMsg({ kind: 'error', text: '赔付金额为 0 元，禁止审批。' })
      return
    }
    const needsFinance = Number(selectedComp.amount) > 50000
    const role = needsFinance ? 'finance' : 'district_manager'
    const result = approveCompensation(selectedComp.id, {
      at: new Date().toISOString(),
      role,
    })
    if (!result.ok) {
      setApprovalMsg({ kind: 'error', text: `${result.code}：${result.message}` })
      return
    }
    setApprovalMsg({
      kind: result.idempotent ? 'dup' : 'ok',
      text: result.idempotent
        ? '该赔付已审批，幂等返回已有记录，未重复入账。'
        : `审批通过：由${ROLE_LABELS[role]}记账，审批链新增 1 条记录。`,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* 新建赔付                                                                */
  /* ---------------------------------------------------------------------- */
  const octoberCompleted = useMemo(
    () =>
      (state.orders || [])
        .filter(
          (order) =>
            order.status === 'completed' &&
            typeof order.completed_at === 'string' &&
            order.completed_at.startsWith('2026-10'),
        )
        .slice()
        .sort((a, b) => {
          const ta = Date.parse(a.completed_at)
          const tb = Date.parse(b.completed_at)
          return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
        }),
    [state.orders],
  )

  const createCandidates = useMemo(() => {
    const kw = createQuery.trim().toLowerCase()
    const list = kw
      ? octoberCompleted.filter((order) =>
          `${order.order_no} ${order.id}`.toLowerCase().includes(kw),
        )
      : octoberCompleted
    return list.slice(0, 20)
  }, [octoberCompleted, createQuery])

  const createOrder = useMemo(
    () => (state.orders || []).find((order) => order.id === createOrderId) || null,
    [state.orders, createOrderId],
  )

  const createPriorCount = useMemo(() => {
    if (!createOrder) return 0
    return compensations.filter((comp) => {
      if (comp.reason !== createReason) return false
      if (comp.status !== 'approved') return false
      const order = orderMap.get(comp.order_id)
      return order && order.cleaner_id === createOrder.cleaner_id
    }).length
  }, [compensations, orderMap, createOrder, createReason])

  function handleCreateEvaluate() {
    const cents = parseYuanToCents(createAmount)
    if (!createOrder) {
      setCreateMsg({ kind: 'error', text: '请先选择一张 2026-10 已完成工单。' })
      setCreateEval(null)
      return
    }
    if (!cents) {
      setCreateMsg({ kind: 'error', text: '赔付金额必须大于 0 元（0 元不允许）。' })
      setCreateEval(null)
      return
    }
    const complaint = latestComplaintForOrder(state.complaints, createOrder.id)
    try {
      const result = decideResponsibility({
        order: toOrderEvidence(createOrder),
        complaintAt: complaint?.created_at || '',
        claimAmount: cents,
        hasCustomerPrePhoto: createHasPrePhoto,
        productDefectEvidence: createProductDefect,
        priorSameTypeCount: createPriorCount,
        source: 'auto',
      })
      setCreateEval(result)
      setCreateMsg(null)
    } catch (error) {
      setCreateEval(null)
      setCreateMsg({ kind: 'error', text: error?.message || '评估失败' })
    }
  }

  function handleCreateSubmit() {
    if (!createOrder) {
      setCreateMsg({ kind: 'error', text: '请先选择一张 2026-10 已完成工单。' })
      return
    }
    const cents = parseYuanToCents(createAmount)
    if (!cents) {
      setCreateMsg({ kind: 'error', text: '赔付金额必须大于 0 元（0 元不允许）。' })
      return
    }
    const complaint = latestComplaintForOrder(state.complaints, createOrder.id)
    let result
    try {
      result = decideResponsibility({
        order: toOrderEvidence(createOrder),
        complaintAt: complaint?.created_at || '',
        claimAmount: cents,
        hasCustomerPrePhoto: createHasPrePhoto,
        productDefectEvidence: createProductDefect,
        priorSameTypeCount: createPriorCount,
        source: 'auto',
      })
    } catch (error) {
      setCreateMsg({ kind: 'error', text: error?.message || '评估失败，未提交' })
      return
    }

    const signature = [
      createOrder.id,
      createReason,
      cents,
      createHasPrePhoto ? 1 : 0,
      createProductDefect ? 1 : 0,
    ].join('|')
    const reuseSameId = lastSubmit && lastSubmit.signature === signature
    const id = reuseSameId
      ? lastSubmit.id
      : nextCompensationId(state.compensations)

    const input = {
      id,
      order_id: createOrder.id,
      reason: createReason,
      amount: cents,
      status: 'pending_approval',
      responsibility: result.responsibility,
      evidence_score: result.evidenceScore,
      evidence_refs: buildEvidenceRefs(createOrder, complaint),
      idempotency_key: id,
    }
    const writeResult = addCompensation(input)
    if (!writeResult.ok) {
      setCreateMsg({
        kind: 'error',
        text: `${writeResult.code}：${writeResult.message}`,
      })
      return
    }
    setCreateEval(result)
    setLastSubmit({ id, signature, input })
    selectComp(writeResult.data.id)
    setCreateMsg({
      kind: writeResult.duplicate ? 'dup' : 'ok',
      text: writeResult.duplicate
        ? `幂等命中：${id} 已存在，返回已有记录，未重复入账。`
        : `已创建 ${id}（待审批，${REASON_LABELS[createReason]} / ${formatYuan(
            cents,
          )}），可在上方赔付详情直接审批。`,
    })
  }

  function handleRepeatSubmit() {
    if (!lastSubmit) return
    const writeResult = addCompensation(lastSubmit.input)
    if (!writeResult.ok) {
      setCreateMsg({
        kind: 'error',
        text: `${writeResult.code}：${writeResult.message}`,
      })
      return
    }
    setCreateMsg({
      kind: writeResult.duplicate ? 'dup' : 'ok',
      text: writeResult.duplicate
        ? `幂等命中：${lastSubmit.id} 已存在，返回已有记录，未重复入账（idempotency_key 相同）。`
        : `重复提交已写入 ${writeResult.data.id}。`,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* 表格列                                                                  */
  /* ---------------------------------------------------------------------- */
  const columns = [
    {
      key: 'id',
      title: '赔付号',
      width: '120px',
      render: (row) => (
        <div className="cmp-idcell">
          <span>{row.id}</span>
          {row.id === selectedId && <Badge tone="accent">已选</Badge>}
        </div>
      ),
    },
    {
      key: 'order_no',
      title: '工单号',
      render: (row) => orderMap.get(row.order_id)?.order_no || row.order_id || '—',
    },
    {
      key: 'district',
      title: '片区',
      render: (row) =>
        districtMap.get(row.district_id)?.name || row.district_id || '—',
    },
    {
      key: 'reason',
      title: '原因',
      render: (row) => REASON_LABELS[row.reason] || row.reason || '—',
    },
    {
      key: 'responsibility',
      title: '责任方',
      render: (row) => (
        <StatusBadge
          status={row.responsibility}
          label={RESP_LABELS[row.responsibility] || row.responsibility}
        />
      ),
    },
    {
      key: 'amount',
      title: '金额',
      align: 'right',
      render: (row) => <Money cents={row.amount} />,
    },
    {
      key: 'evidence_score',
      title: '证据分',
      align: 'right',
      render: (row) =>
        Number.isFinite(Number(row.evidence_score)) ? row.evidence_score : '—',
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => (
        <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />
      ),
    },
    {
      key: 'approved_at',
      title: '审批时间',
      render: (row) => fmtDateTime(row.approved_at || row.decided_at),
    },
  ]

  /* ---------------------------------------------------------------------- */
  /* 渲染                                                                    */
  /* ---------------------------------------------------------------------- */
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M2</span>
          <h1>赔付管理</h1>
          <p className="muted">
            赔付台账、证据评分、自动定责、人工复核与审批链
          </p>
        </div>
      </header>

      <div className="cmp-notice" role="note">
        <strong>规则声明：</strong>
        数据全部虚构，仅用于教学演示；赔付 &gt;300 元需二次审批，&gt;500 元需财务终审；
        自动定责路径永不返回“无责”，无责只能由人工复核判定并填写理由。
      </div>

      {/* KPI */}
      <div className="stat-grid">
        <StatTile
          label="赔付单数"
          value={fmtNumber(kpis.total)}
          hint={`已审批 ${fmtNumber(kpis.approvedCount)} 单`}
          tone="info"
        />
        <StatTile
          label="已审批赔付总额"
          value={formatYuan(kpis.approvedTotal)}
          hint={`${fmtNumber(kpis.approvedCount)} 笔已入账`}
          tone="accent"
        />
        <StatTile
          label="待审批"
          value={`${fmtNumber(kpis.pendingCount)} 单`}
          hint={`合计 ${formatYuan(kpis.pendingTotal)}`}
          tone="warning"
        />
        <StatTile
          label="无法定责率"
          value={fmtPct(undetermined.pct, 1)}
          hint={`${undetermined.count}/${undetermined.total} 单责任待定`}
          tone="danger"
        />
        <StatTile
          label="平均证据分"
          value={kpis.avgScore === null ? '—' : fmtNumber(kpis.avgScore, 1)}
          hint="E1–E6 证据评分均值（满分 100）"
          tone="neutral"
        />
      </div>

      {/* 分布 */}
      <div className="cmp-chart-grid">
        <Card
          title="按责任方分布"
          subtitle={`全部 ${fmtNumber(kpis.total)} 笔赔付`}
          actions={
            <div className="cmp-toggle" role="group" aria-label="责任方分布维度">
              <button
                type="button"
                className={`btn${respMode === 'count' ? ' is-on' : ''}`}
                onClick={() => setRespMode('count')}
              >
                件数
              </button>
              <button
                type="button"
                className={`btn${respMode === 'amount' ? ' is-on' : ''}`}
                onClick={() => setRespMode('amount')}
              >
                金额
              </button>
            </div>
          }
        >
          <BarChart
            data={chartData(distributions.responsibility, respMode)}
            width={560}
            height={250}
            ariaLabel="赔付责任方分布"
            formatValue={(value) =>
              respMode === 'amount'
                ? `${fmtNumber(toYuan(value))}元`
                : `${fmtNumber(value)}件`
            }
            emptyTitle="暂无责任方分布"
          />
        </Card>

        <Card
          title="按原因分布"
          subtitle={`全部 ${fmtNumber(kpis.total)} 笔赔付`}
          actions={
            <div className="cmp-toggle" role="group" aria-label="原因分布维度">
              <button
                type="button"
                className={`btn${reasonMode === 'count' ? ' is-on' : ''}`}
                onClick={() => setReasonMode('count')}
              >
                件数
              </button>
              <button
                type="button"
                className={`btn${reasonMode === 'amount' ? ' is-on' : ''}`}
                onClick={() => setReasonMode('amount')}
              >
                金额
              </button>
            </div>
          }
        >
          <BarChart
            data={chartData(distributions.reason, reasonMode)}
            width={560}
            height={250}
            ariaLabel="赔付原因分布"
            formatValue={(value) =>
              reasonMode === 'amount'
                ? `${fmtNumber(toYuan(value))}元`
                : `${fmtNumber(value)}件`
            }
            emptyTitle="暂无原因分布"
          />
        </Card>
      </div>

      {/* 列表 */}
      <Card
        title="赔付台账"
        subtitle={`共 ${fmtNumber(compensations.length)} 笔 · 当前筛选 ${fmtNumber(
          filtered.length,
        )} 笔 · 点击行查看证据与定责`}
        className="cmp-table-card"
      >
        <FilterBar
          className="cmp-filters"
          actions={
            <button type="button" className="btn" onClick={resetFilters}>
              重置筛选
            </button>
          }
        >
          <label className="field">
            状态
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">全部</option>
              {COMPENSATION_STATUS.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status] || status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            责任方
            <select
              value={respFilter}
              onChange={(event) => {
                setRespFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">全部</option>
              {RESPONSIBILITIES.map((resp) => (
                <option key={resp} value={resp}>
                  {RESP_LABELS[resp] || resp}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            原因
            <select
              value={reasonFilter}
              onChange={(event) => {
                setReasonFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">全部</option>
              {COMPENSATION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REASON_LABELS[reason] || reason}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            关键词
            <input
              type="search"
              value={keyword}
              placeholder="赔付号 / 工单号"
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
            />
          </label>
        </FilterBar>

        <Table
          columns={columns}
          rows={pageRows}
          rowKey="id"
          onRowClick={(row) => selectComp(row.id)}
          empty="暂无符合条件的赔付"
          emptyHint="调整筛选条件，或清空关键词后重试。"
          caption="赔付台账"
          dense
        />

        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onChange={setPage}
        />
      </Card>

      {/* 详情 + 定责助手 */}
      <Card
        title={selectedComp ? `赔付详情 · ${selectedComp.id}` : '赔付详情'}
        subtitle="工单证据 → 自动定责 → 人工复核 → 审批链"
        actions={
          selectedComp ? (
            <div className="cmp-row">
              <StatusBadge
                status={selectedComp.status}
                label={STATUS_LABELS[selectedComp.status]}
              />
              <Money cents={selectedComp.amount} />
            </div>
          ) : null
        }
      >
        {!selectedComp ? (
          <EmptyState
            title="请选择一笔赔付"
            hint="在赔付台账点击任意一行，查看关联工单证据、定责助手与审批链。"
          />
        ) : (
          <div className="cmp-split">
            {/* 左：证据 */}
            <div>
              <div className="cmp-panel">
                <h3 className="cmp-subtitle">关联工单与证据</h3>
                {!orderDetail?.order ? (
                  <EmptyState
                    title="关联工单不存在"
                    hint={`order_id：${selectedComp.order_id}`}
                  />
                ) : (
                  <>
                    <dl className="cmp-kv">
                      <dt>工单号</dt>
                      <dd>{orderDetail.order.order_no}</dd>
                      <dt>片区</dt>
                      <dd>
                        {orderDetail.district?.name || selectedComp.district_id || '—'}
                      </dd>
                      <dt>客户</dt>
                      <dd>{orderDetail.customer?.name || orderDetail.order.customer_id}</dd>
                      <dt>阿姨</dt>
                      <dd>
                        {orderDetail.cleaner?.name
                          ? `${orderDetail.cleaner.name}（${orderDetail.cleaner.id}）`
                          : orderDetail.order.cleaner_id || '—'}
                      </dd>
                      <dt>签到时间</dt>
                      <dd>{fmtDateTime(orderDetail.order.checkin_at)}</dd>
                      <dt>完成时间</dt>
                      <dd>{fmtDateTime(orderDetail.order.completed_at)}</dd>
                      <dt>客户签字</dt>
                      <dd>
                        {orderDetail.order.signature ? (
                          <code className="cmp-ref">{orderDetail.order.signature}</code>
                        ) : (
                          <Badge tone="warning">缺失</Badge>
                        )}
                      </dd>
                      <dt>最新投诉</dt>
                      <dd>
                        {latestComplaint ? (
                          <>
                            {fmtDateTime(latestComplaint.created_at)}
                            {latestComplaint.id ? (
                              <span className="muted">（{latestComplaint.id}）</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">无投诉记录</span>
                        )}
                      </dd>
                    </dl>
                    <EvidenceRefs
                      title="服务前照片"
                      refs={orderDetail.order.photos_before}
                    />
                    <EvidenceRefs
                      title="服务后照片"
                      refs={orderDetail.order.photos_after}
                    />
                  </>
                )}
              </div>

              <div className="cmp-panel">
                <h3 className="cmp-subtitle">同类历史（阿姨 × 原因）</h3>
                <div className="cmp-row">
                  <span>
                    该阿姨「{REASON_LABELS[selectedComp.reason] || selectedComp.reason}」
                    已审批历史 <b>{priorSameTypeCount}</b> 次
                  </span>
                  {priorSameTypeCount >= 2 && (
                    <Badge tone="warning" dot>
                      重点关注
                    </Badge>
                  )}
                </div>
                <p className="cmp-hint">
                  口径：同一 cleaner_id、同一 reason、状态为已审批的赔付数量，排除本单。
                  priorSameTypeCount ≥2 时自动评估会标注关注，但不改变责任方。
                </p>
              </div>

              <div className="cmp-panel">
                <h3 className="cmp-subtitle">赔付参考（calcCompensation 口径）</h3>
                <dl className="cmp-kv">
                  <dt>赔付原因</dt>
                  <dd>{REASON_LABELS[selectedComp.reason] || selectedComp.reason}</dd>
                  <dt>当前责任方</dt>
                  <dd>
                    <StatusBadge
                      status={selectedComp.responsibility}
                      label={RESP_LABELS[selectedComp.responsibility]}
                    />
                  </dd>
                  <dt>证据分</dt>
                  <dd>
                    {Number.isFinite(Number(selectedComp.evidence_score))
                      ? selectedComp.evidence_score
                      : '—'}
                  </dd>
                  <dt>证据引用</dt>
                  <dd>
                    {(selectedComp.evidence_refs || []).length > 0 ? (
                      <div className="cmp-ref-list">
                        {selectedComp.evidence_refs.map((ref) => (
                          <code className="cmp-ref" key={ref}>
                            {ref}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">无</span>
                    )}
                  </dd>
                  {compensationAdvice && (
                    <>
                      <dt>公司应付</dt>
                      <dd>
                        <Money cents={compensationAdvice.payable} />
                      </dd>
                      <dt>追偿建议</dt>
                      <dd>
                        <Money cents={compensationAdvice.recoverable} />
                      </dd>
                    </>
                  )}
                </dl>
                {compensationAdvice && compensationAdvice.warnings.length > 0 && (
                  <ul className="cmp-reasons">
                    {compensationAdvice.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* 右：定责 + 审批 */}
            <div>
              <div className="cmp-panel">
                <h3 className="cmp-subtitle">审批</h3>
                <div className="cmp-row">
                  <span>金额</span>
                  <Money cents={selectedComp.amount} />
                  <Badge tone={Number(selectedComp.amount) > 50000 ? 'danger' : 'info'}>
                    {Number(selectedComp.amount) > 50000
                      ? '需财务终审'
                      : Number(selectedComp.amount) > 30000
                        ? '需二次审批'
                        : '常规审批'}
                  </Badge>
                </div>
                {Number(selectedComp.amount) > 30000 && (
                  <p className="cmp-hint">
                    &gt;300 元：自动定责结果需二次人工审批复核。
                  </p>
                )}
                {Number(selectedComp.amount) > 50000 && (
                  <p className="cmp-hint">
                    &gt;500 元：审批角色必须为财务，按钮已切换为「财务终审」。
                  </p>
                )}
                {canApprove ? (
                  <div className="cmp-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleApprove}
                    >
                      {Number(selectedComp.amount) > 50000
                        ? '审批通过（财务终审）'
                        : '审批通过（片区经理）'}
                    </button>
                  </div>
                ) : (
                  <p className="cmp-hint">
                    当前状态「{STATUS_LABELS[selectedComp.status] || selectedComp.status}」
                    不可审批，仅展示审批链。
                  </p>
                )}
                {approvalMsg && (
                  <div className={`cmp-msg ${msgClass(approvalMsg.kind)}`}>
                    {approvalMsg.text}
                  </div>
                )}
                <h3 className="cmp-subtitle cmp-chain-title">
                  审批链（approver_chain）
                </h3>
                {(selectedComp.approver_chain || []).length > 0 ? (
                  <ul className="cmp-chain">
                    {selectedComp.approver_chain.map((item, index) => (
                      <li key={`${item.role}-${item.at}-${index}`}>
                        <Badge tone={item.role === 'finance' ? 'danger' : 'info'}>
                          {ROLE_LABELS[item.role] || item.role}
                        </Badge>
                        <span>{item.user || 'demo'}</span>
                        <span className="muted">{fmtDateTime(item.at)}</span>
                        <Badge tone={item.decision === 'approve' ? 'success' : 'danger'}>
                          {item.decision === 'approve' ? '通过' : '驳回'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="cmp-hint">尚未审批，审批后在此展示审批链。</p>
                )}
              </div>

              <div className="cmp-panel">
                <h3 className="cmp-subtitle">定责助手 · 自动评估</h3>
                <label className="cmp-check">
                  <input
                    type="checkbox"
                    checked={autoHasPrePhoto}
                    onChange={(event) => {
                      setAutoHasPrePhoto(event.target.checked)
                      setAutoResult(null)
                    }}
                  />
                  客户提供了服务前已损坏照片
                </label>
                <label className="cmp-check">
                  <input
                    type="checkbox"
                    checked={autoProductDefect}
                    onChange={(event) => {
                      setAutoProductDefect(event.target.checked)
                      setAutoResult(null)
                    }}
                  />
                  存在耗材 / 设备缺陷证据
                </label>
                <div className="cmp-actions">
                  <button type="button" className="btn btn-primary" onClick={handleAutoEvaluate}>
                    自动评估
                  </button>
                </div>
                {autoError && <div className="cmp-msg is-error">{autoError}</div>}
                {autoResult ? (
                  <ResultPanel result={autoResult} />
                ) : (
                  <p className="cmp-hint">
                    依据 E1–E6 证据评分与判定顺序；自动路径不会返回“无责”。
                  </p>
                )}
              </div>

              <div className="cmp-panel">
                <h3 className="cmp-subtitle">人工复核</h3>
                <div className="cmp-manual-row">
                  <label className="field">
                    责任方
                    <select
                      value={manualResp}
                      onChange={(event) => setManualResp(event.target.value)}
                    >
                      {RESPONSIBILITIES.map((resp) => (
                        <option key={resp} value={resp}>
                          {RESP_LABELS[resp] || resp}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field cmp-grow">
                    理由（必填）
                    <input
                      type="text"
                      value={manualReason}
                      placeholder="如：客户撤销索赔 / 证据不足，人工改判"
                      onChange={(event) => setManualReason(event.target.value)}
                    />
                  </label>
                </div>
                <div className="cmp-actions">
                  <button type="button" className="btn" onClick={handleManualDecide}>
                    人工定责
                  </button>
                </div>
                {manualMsg && (
                  <div className={`cmp-msg ${msgClass(manualMsg.kind)}`}>
                    {manualMsg.text}
                  </div>
                )}
                {manualResult && <ResultPanel result={manualResult} />}
                <p className="cmp-hint">
                  仅人工路径可产生“无责”。真实系统会将在人工定责结果落库（version+1 并记录
                  manualReason / 审计留痕），本演示仅展示判定结果，入账仍需审批。
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 新建赔付 */}
      <Card
        title="新建赔付（闭环）"
        subtitle="仅从 2026-10 已完成工单中选择 · 自动评估后提交为待审批"
      >
        <div className="cmp-create-grid">
          <div className="cmp-panel">
            <h3 className="cmp-subtitle">1. 选择工单</h3>
            <label className="field">
              按工单号搜索
              <input
                type="search"
                value={createQuery}
                placeholder="如 NJ2026100001（列表取最近 20 条）"
                onChange={(event) => setCreateQuery(event.target.value)}
              />
            </label>
            <div className="cmp-order-list">
              {createCandidates.length === 0 ? (
                <div className="cmp-empty-inline">未找到 2026-10 已完成工单</div>
              ) : (
                createCandidates.map((order) => (
                  <button
                    type="button"
                    key={order.id}
                    className={`cmp-order-item${
                      order.id === createOrderId ? ' is-selected' : ''
                    }`}
                    onClick={() => {
                      setCreateOrderId(order.id)
                      setCreateEval(null)
                      setCreateMsg(null)
                    }}
                  >
                    <span>
                      <span className="cmp-order-no">{order.order_no}</span>
                      <span className="cmp-order-meta">
                        {' '}
                        · {districtMap.get(order.district_id)?.name || order.district_id}
                      </span>
                    </span>
                    <span className="cmp-order-meta">
                      {fmtDateTime(order.completed_at)}
                    </span>
                  </button>
                ))
              )}
            </div>
            {createOrder && (
              <div className="cmp-selected-order">
                已选 <b>{createOrder.order_no}</b> · 阿姨{' '}
                {cleanerMap.get(createOrder.cleaner_id)?.name ||
                  createOrder.cleaner_id}{' '}
                · 完成 {fmtDateTime(createOrder.completed_at)} · 前照片{' '}
                {(createOrder.photos_before || []).length} 张 · 后照片{' '}
                {(createOrder.photos_after || []).length} 张 · 签字{' '}
                {createOrder.signature ? '有' : '无'} · 该阿姨同类已审批历史{' '}
                {createPriorCount} 次
              </div>
            )}
          </div>

          <div className="cmp-panel">
            <h3 className="cmp-subtitle">2. 赔付信息与评估</h3>
            <div className="cmp-form-grid">
              <label className="field">
                赔付原因
                <select
                  value={createReason}
                  onChange={(event) => {
                    setCreateReason(event.target.value)
                    setCreateEval(null)
                    setCreateMsg(null)
                  }}
                >
                  {COMPENSATION_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {REASON_LABELS[reason] || reason}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                赔付金额（元）
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={createAmount}
                  placeholder="例如 320.00"
                  onChange={(event) => {
                    setCreateAmount(event.target.value)
                    setCreateEval(null)
                    setCreateMsg(null)
                  }}
                />
              </label>
            </div>
            <label className="cmp-check">
              <input
                type="checkbox"
                checked={createHasPrePhoto}
                onChange={(event) => {
                  setCreateHasPrePhoto(event.target.checked)
                  setCreateEval(null)
                }}
              />
              客户提供服务前已损坏照片
            </label>
            <label className="cmp-check">
              <input
                type="checkbox"
                checked={createProductDefect}
                onChange={(event) => {
                  setCreateProductDefect(event.target.checked)
                  setCreateEval(null)
                }}
              />
              存在耗材 / 设备缺陷证据
            </label>
            <div className="cmp-actions">
              <button type="button" className="btn" onClick={handleCreateEvaluate}>
                自动评估
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCreateSubmit}>
                提交赔付（待审批）
              </button>
            </div>
            {createEval && (
              <ResultPanel result={createEval} />
            )}
            {createMsg && (
              <div className={`cmp-msg ${msgClass(createMsg.kind)}`}>
                {createMsg.text}
              </div>
            )}
            {lastSubmit && (
              <div className="cmp-last-id">
                <span>
                  上次幂等键：<code className="cmp-ref">{lastSubmit.id}</code>
                </span>
                <button type="button" className="btn" onClick={handleRepeatSubmit}>
                  重复提交同 id（验证幂等）
                </button>
              </div>
            )}
            <p className="cmp-hint">
              提交后自动进入「待审批」，可在上方赔付详情直接审批。金额 &gt;300 元需二次复核，
              &gt;500 元审批角色为财务（财务终审）。0 元不允许提交。
            </p>
          </div>
        </div>
      </Card>

      <style>{`
        .cmp-notice {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin: 12px 0 16px;
          padding: 10px 14px;
          border: 1px solid #fde68a;
          border-radius: var(--radius);
          background: var(--warning-soft);
          color: #7c2d12;
          font-size: 12px;
          line-height: 1.7;
        }
        .cmp-notice strong { color: #92400e; }

        .cmp-chart-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 16px;
          margin-bottom: 16px;
        }

        .cmp-toggle {
          display: inline-flex;
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-sm);
          overflow: hidden;
        }
        .cmp-toggle .btn {
          border: 0;
          border-radius: 0;
          padding: 4px 10px;
          font-size: 12px;
          background: transparent;
        }
        .cmp-toggle .btn.is-on {
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-weight: 600;
        }

        .cmp-filters { margin-bottom: 12px; }
        .cmp-table-card { margin-bottom: 16px; }

        .cmp-idcell {
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }

        .cmp-split {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }
        .cmp-create-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .cmp-split { grid-template-columns: 1fr; }
        }

        .cmp-panel {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface-2);
          padding: 12px 14px;
        }
        .cmp-panel + .cmp-panel { margin-top: 12px; }
        .cmp-create-grid > .cmp-panel + .cmp-panel { margin-top: 0; }

        .cmp-subtitle {
          margin: 0 0 8px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-2);
        }
        .cmp-chain-title { margin-top: 14px; }

        .cmp-kv {
          display: grid;
          grid-template-columns: 84px minmax(0, 1fr);
          gap: 6px 10px;
          margin: 0;
          font-size: 12px;
        }
        .cmp-kv dt { color: var(--muted); }
        .cmp-kv dd { margin: 0; color: var(--text); word-break: break-word; }

        .cmp-ref-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .cmp-ref {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          color: var(--text-2);
          background: var(--surface-3);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 5px;
          word-break: break-all;
        }

        .cmp-evidence {
          margin-top: 10px;
          font-size: 12px;
          color: var(--muted);
        }
        .cmp-evidence b { color: var(--text); }

        .cmp-result {
          margin-top: 10px;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface);
        }
        .cmp-result-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-2);
        }
        .cmp-reasons {
          margin: 8px 0 0;
          padding-left: 18px;
          font-size: 12px;
          line-height: 1.7;
          color: var(--text-2);
        }

        .cmp-msg {
          margin-top: 10px;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          line-height: 1.6;
          border: 1px solid transparent;
        }
        .cmp-msg.is-ok {
          background: var(--success-soft);
          border-color: #a7f3d0;
          color: #065f46;
        }
        .cmp-msg.is-dup {
          background: var(--warning-soft);
          border-color: #fde68a;
          color: #92400e;
        }
        .cmp-msg.is-error {
          background: var(--danger-soft);
          border-color: #fecaca;
          color: #991b1b;
        }

        .cmp-hint {
          margin: 8px 0 0;
          font-size: 11px;
          line-height: 1.7;
          color: var(--muted);
        }

        .cmp-chain {
          list-style: none;
          margin: 8px 0 0;
          padding: 0;
          font-size: 12px;
        }
        .cmp-chain li {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          border-top: 1px dashed var(--border);
        }
        .cmp-chain li:first-child { border-top: 0; }

        .cmp-check {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 6px 0;
          font-size: 12px;
          color: var(--text-2);
        }
        .cmp-check input { accent-color: var(--accent); }

        .cmp-manual-row {
          display: flex;
          align-items: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .cmp-grow { flex: 1; min-width: 160px; }
        .cmp-grow input { width: 100%; }

        .cmp-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 12px;
        }

        .cmp-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }

        .cmp-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 8px;
        }
        .cmp-form-grid .field input { width: 100%; }

        .cmp-order-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 220px;
          overflow: auto;
          margin-top: 8px;
          padding-right: 2px;
        }
        .cmp-order-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 9px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface);
          color: var(--text-2);
          font-size: 12px;
          text-align: left;
          cursor: pointer;
        }
        .cmp-order-item:hover { border-color: var(--border-strong); }
        .cmp-order-item.is-selected {
          border-color: var(--accent);
          background: var(--accent-soft);
        }
        .cmp-order-no { font-weight: 600; color: var(--text); }
        .cmp-order-meta { color: var(--muted); font-size: 11px; white-space: nowrap; }

        .cmp-selected-order {
          margin-top: 8px;
          font-size: 12px;
          line-height: 1.7;
          color: var(--muted);
        }
        .cmp-selected-order b { color: var(--text); }

        .cmp-empty-inline {
          padding: 10px;
          font-size: 12px;
          color: var(--muted);
        }

        .cmp-last-id {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
          font-size: 12px;
          color: var(--text-2);
        }
      `}</style>
    </section>
  )
}
