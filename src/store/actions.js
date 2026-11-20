/**
 * 写操作集中入口（docs §4.3）。
 *
 * 统一返回：
 *   { ok: true, data } | { ok: false, code, message }
 *
 * 幂等：赔付按 idempotency_key（=赔付 ID）；结算按 cleaner_id+order_id+period；
 * 工单创建按 idempotency_key。重复调用返回已有记录，不重复入账。
 */
import { store } from '../store.js'
import { ORDER_TRANSITIONS } from '../domain/types.js'
import { clamp, isFiniteNumber } from '../domain/money.js'
import { resetSeed } from '../data/loader.js'

function ok(data, extra = {}) {
  return { ok: true, data, ...extra }
}

function fail(code, message) {
  return { ok: false, code, message }
}

function nowLike(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 新建工单（状态 created）。
 * @param {Object} input
 */
export function createOrder(input) {
  const order = input || {}
  if (!order.id || !order.order_no) {
    return fail('INVALID_INPUT', '工单 id / order_no 必填')
  }
  if (!isFiniteNumber(order.amount) || order.amount <= 0) {
    return fail('INVALID_INPUT', '工单金额必须为正整数分')
  }
  if (!order.district_id || !order.customer_id || !order.cleaner_id) {
    return fail('INVALID_INPUT', '片区、客户、阿姨必填')
  }
  const state = store.getState()
  if (!state.districts.some((d) => d.id === order.district_id)) {
    return fail('NOT_FOUND', '片区不存在')
  }
  if (!state.customers.some((c) => c.id === order.customer_id)) {
    return fail('NOT_FOUND', '客户不存在')
  }
  if (!state.cleaners.some((c) => c.id === order.cleaner_id)) {
    return fail('NOT_FOUND', '阿姨不存在')
  }

  const key = order.idempotency_key || `create:${order.id}`
  const existing = state.orders.find(
    (o) => o.id === order.id || o.idempotency_key === key,
  )
  if (existing) return ok(existing, { duplicate: true })

  const next = {
    photos_before: [],
    photos_after: [],
    signature: null,
    is_rework: false,
    rework_of_order_id: null,
    cancel_reason: null,
    created_by: 'demo',
    created_at: null,
    updated_at: null,
    ...order,
    status: order.status || 'created',
    idempotency_key: key,
  }
  store.setState({ orders: [next, ...state.orders] })
  return ok(next)
}

/**
 * 工单状态流转（不可跳步）。
 * @param {string} orderId
 * @param {string} nextStatus
 * @param {{at?:string, cancelReason?:string, allowMissingSignature?:boolean}} [options]
 */
export function transitionOrder(orderId, nextStatus, options = {}) {
  const state = store.getState()
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) return fail('NOT_FOUND', '工单不存在')
  if (order.status === nextStatus) return ok(order, { idempotent: true })

  const allowed = ORDER_TRANSITIONS[order.status] || []
  if (!allowed.includes(nextStatus)) {
    return fail('INVALID_TRANSITION', `不允许从 ${order.status} 流转到 ${nextStatus}`)
  }

  if (nextStatus === 'completed' && !order.signature && !options.allowMissingSignature) {
    return fail('MISSING_SIGNATURE', '缺少客户签字，不能完成')
  }

  const at = nowLike(options.at)
  const patch = {
    status: nextStatus,
    updated_at: at || order.updated_at || null,
  }
  if (nextStatus === 'checked_in') patch.checkin_at = at || order.checkin_at || null
  if (nextStatus === 'completed') {
    if (!at && !order.completed_at) return fail('MISSING_TIME', '缺少完成时间')
    patch.completed_at = at || order.completed_at
    if (!patch.updated_at) patch.updated_at = patch.completed_at
  }
  if (nextStatus === 'cancelled') {
    patch.cancel_reason = options.cancelReason || '未填写原因'
  }

  const updated = { ...order, ...patch }
  store.setState({
    orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
  })
  return ok(updated)
}

/**
 * 新建赔付（幂等键 = idempotency_key || id）。
 * @param {Object} input
 */
export function addCompensation(input) {
  const comp = input || {}
  if (!comp.id) return fail('INVALID_INPUT', '赔付 id 必填')
  if (!comp.order_id) return fail('INVALID_INPUT', '必须关联工单')
  if (!isFiniteNumber(comp.amount) || comp.amount <= 0) {
    return fail('INVALID_INPUT', '赔付金额必须为正整数分')
  }
  const state = store.getState()
  const order = state.orders.find((o) => o.id === comp.order_id)
  if (!order) return fail('NOT_FOUND', '关联工单不存在')

  const key = comp.idempotency_key || comp.id
  const existing = state.compensations.find(
    (c) => c.id === comp.id || c.idempotency_key === key,
  )
  if (existing) return ok(existing, { duplicate: true })

  const next = {
    district_id: order.district_id,
    reason: 'other',
    responsibility: 'undetermined',
    evidence_score: 0,
    evidence_refs: [],
    status: 'pending_approval',
    approver_chain: [],
    decided_at: null,
    approved_at: null,
    appeal_note: null,
    version: 1,
    ...comp,
    idempotency_key: key,
  }
  store.setState({ compensations: [next, ...state.compensations] })
  return ok(next)
}

function touchCustomerAfterCompensation(state, comp) {
  const order = state.orders.find((o) => o.id === comp.order_id)
  if (!order) return state.customers
  return state.customers.map((customer) => {
    if (customer.id !== order.customer_id) return customer
    const tags = new Set(customer.tags || [])
    tags.add('赔付关注')
    return {
      ...customer,
      compensation_amount: (customer.compensation_amount || 0) + comp.amount,
      tags: [...tags],
    }
  })
}

/**
 * 审批赔付（幂等：重复调用返回已审批记录，不重复计账）。
 * @param {string} id
 * @param {{at?:string, role?:'district_manager'|'finance', user?:string}} [options]
 */
export function approveCompensation(id, options = {}) {
  const state = store.getState()
  const comp = state.compensations.find((c) => c.id === id)
  if (!comp) return fail('NOT_FOUND', '赔付不存在')
  if (comp.status === 'approved') return ok(comp, { idempotent: true })
  if (comp.status !== 'pending_approval' && comp.status !== 'draft') {
    return fail('INVALID_TRANSITION', `赔付状态 ${comp.status} 不可审批`)
  }

  const role = options.role || 'district_manager'
  if (comp.amount > 50000 && role !== 'finance') {
    return fail('FORBIDDEN', '金额 >500 元，需财务终审')
  }
  const at = nowLike(options.at)
  if (!at) return fail('MISSING_TIME', '审批时间必填（由调用方注入）')

  const updated = {
    ...comp,
    status: 'approved',
    decided_at: at,
    approved_at: at,
    approver_chain: [
      ...(comp.approver_chain || []),
      { role, user: options.user || 'demo', at, decision: 'approve' },
    ],
  }
  store.setState({
    compensations: state.compensations.map((c) => (c.id === id ? updated : c)),
    customers: touchCustomerAfterCompensation(state, updated),
  })
  return ok(updated)
}

/**
 * 新建投诉。
 * @param {Object} input
 */
export function addComplaint(input) {
  const complaint = input || {}
  if (!complaint.id) return fail('INVALID_INPUT', '投诉 id 必填')
  if (!complaint.order_id) return fail('INVALID_INPUT', '必须关联工单')
  const state = store.getState()
  const order = state.orders.find((o) => o.id === complaint.order_id)
  if (!order) return fail('NOT_FOUND', '关联工单不存在')
  if (state.complaints.some((c) => c.id === complaint.id)) {
    return ok(state.complaints.find((c) => c.id === complaint.id), { duplicate: true })
  }
  const next = {
    customer_id: order.customer_id,
    district_id: order.district_id,
    channel: 'phone',
    category: 'other',
    content: '',
    status: 'open',
    compensation_id: null,
    created_at: null,
    resolved_at: null,
    ...complaint,
  }
  store.setState({ complaints: [next, ...state.complaints] })
  return ok(next)
}

/**
 * 新建返工记录（禁止链式返工）。
 * @param {Object} input
 */
export function addRework(input) {
  const record = input || {}
  if (!record.id) return fail('INVALID_INPUT', '返工 id 必填')
  if (!isFiniteNumber(record.cost) || record.cost < 0) {
    return fail('INVALID_INPUT', '返工成本必须为非负整数分')
  }
  const state = store.getState()
  if (!state.orders.some((o) => o.id === record.order_id)) {
    return fail('NOT_FOUND', '原单不存在')
  }
  if (record.rework_order_id && !state.orders.some((o) => o.id === record.rework_order_id)) {
    return fail('NOT_FOUND', '返工单不存在')
  }
  if (state.reworks.some((r) => r.id === record.id)) {
    return ok(state.reworks.find((r) => r.id === record.id), { duplicate: true })
  }
  store.setState({ reworks: [record, ...state.reworks] })
  return ok(record)
}

/**
 * 新建空跑记录。
 * @param {Object} input
 */
export function addIdleRun(input) {
  const record = input || {}
  if (!record.id) return fail('INVALID_INPUT', '空跑 id 必填')
  if (!isFiniteNumber(record.cost) || record.cost < 0) {
    return fail('INVALID_INPUT', '空跑成本必须为非负整数分')
  }
  const state = store.getState()
  if (!state.orders.some((o) => o.id === record.order_id)) {
    return fail('NOT_FOUND', '关联工单不存在')
  }
  if (state.idleRuns.some((r) => r.id === record.id)) {
    return ok(state.idleRuns.find((r) => r.id === record.id), { duplicate: true })
  }
  store.setState({ idleRuns: [record, ...state.idleRuns] })
  return ok(record)
}

/**
 * 设置/清除阿姨质量系数人工覆盖值。
 * @param {string} cleanerId
 * @param {number|null} value
 */
export function setQualityOverride(cleanerId, value) {
  const state = store.getState()
  const cleaner = state.cleaners.find((c) => c.id === cleanerId)
  if (!cleaner) return fail('NOT_FOUND', '阿姨不存在')
  let override = null
  if (value !== null && value !== undefined) {
    if (!isFiniteNumber(value)) return fail('INVALID_INPUT', '质量系数必须为数字或 null')
    override = clamp(value, 0.8, 1.2)
  }
  const updated = { ...cleaner, quality_coef_override: override }
  store.setState({
    cleaners: state.cleaners.map((c) => (c.id === cleanerId ? updated : c)),
  })
  return ok(updated)
}

/**
 * 切换当前账期（写 meta，不重算/不持久化损益）。
 * @param {string} period
 */
export function setActivePeriod(period) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return fail('INVALID_INPUT', '账期必须为 YYYY-MM')
  }
  const state = store.getState()
  store.setState({ meta: { ...state.meta, period } })
  return ok(period)
}

/**
 * 演示重置：清空持久化并重新注入基线种子。
 */
export function resetDemoData() {
  const result = resetSeed()
  return result.injected || result.reason === 'persisted'
    ? ok(result)
    : fail('RESET_FAILED', '种子重置失败')
}
