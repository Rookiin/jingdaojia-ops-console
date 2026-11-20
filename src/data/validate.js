/**
 * 手写 JSON 形状校验（替代 Zod）。
 *
 * 返回 { ok, errors }；errors 中每条都包含字段路径，例如：
 *   orders[12].amount: 期望为正整数分
 *   compensations[0].order_id: 引用的工单不存在
 *
 * 仅做形状/枚举/引用完整性校验，不做损益业务断言。
 */
import {
  CLEANER_STATUS,
  COMPENSATION_REASONS,
  COMPENSATION_STATUS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
  COMPLAINT_STATUS,
  CUSTOMER_STATUS,
  DISTRICT_KINDS,
  DISTRICT_STATUS,
  EMPLOYMENT_TYPES,
  IDLE_RUN_TYPES,
  ORDER_STATUS,
  RESPONSIBILITIES,
  SERVICE_TYPES,
  SETTLEMENT_STATUS,
} from '../domain/types.js'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value) {
  return typeof value === 'string'
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value)
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBoolean(value) {
  return typeof value === 'boolean'
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableString(value) {
  return value === null || typeof value === 'string'
}

function inEnum(value, allowed) {
  return allowed.includes(value)
}

/**
 * @param {unknown} data
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSeed(data) {
  /** @type {string[]} */
  const errors = []
  const push = (path, message) => errors.push(`${path}: ${message}`)

  if (!isObject(data)) {
    return { ok: false, errors: ['root: 期望为对象'] }
  }

  const requiredCollections = [
    'districts',
    'cleaners',
    'customers',
    'orders',
    'compensations',
    'complaints',
    'reworks',
    'idleRuns',
    'settlements',
    'monthlySummary',
    'periodOpening',
  ]
  for (const key of requiredCollections) {
    if (!Array.isArray(data[key])) push(key, '期望为数组')
  }
  if (errors.length > 0) return { ok: false, errors }

  if (!isObject(data.config)) push('config', '期望为对象')
  if (!isObject(data.meta)) push('meta', '期望为对象')

  const districtIds = new Set()
  const cleanerIds = new Set()
  const customerIds = new Set()
  const orderIds = new Set()
  const compensationIds = new Set()

  const unique = (set, id, path) => {
    if (set.has(id)) push(path, `重复的主键 ${id}`)
    set.add(id)
  }

  /* --------------------------- districts --------------------------- */
  data.districts.forEach((d, i) => {
    const path = `districts[${i}]`
    if (!isObject(d)) return push(path, '期望为对象')
    if (!isNonEmptyString(d.id)) push(`${path}.id`, '期望为非空字符串')
    else unique(districtIds, d.id, `${path}.id`)
    if (!isNonEmptyString(d.name)) push(`${path}.name`, '期望为非空字符串')
    if (!inEnum(d.kind, DISTRICT_KINDS)) push(`${path}.kind`, '非法片区类型')
    if (!isNonEmptyString(d.manager)) push(`${path}.manager`, '期望为非空字符串')
    if (!isInteger(d.fixed_cost_monthly) || d.fixed_cost_monthly < 0) {
      push(`${path}.fixed_cost_monthly`, '期望为非负整数分')
    }
    if (!isNumber(d.direct_cost_rate) || d.direct_cost_rate < 0 || d.direct_cost_rate > 1) {
      push(`${path}.direct_cost_rate`, '期望位于 [0,1]')
    }
    if (!isBoolean(d.is_pilot)) push(`${path}.is_pilot`, '期望为布尔值')
    if (!inEnum(d.status, DISTRICT_STATUS)) push(`${path}.status`, '非法片区状态')
  })

  /* --------------------------- cleaners --------------------------- */
  data.cleaners.forEach((c, i) => {
    const path = `cleaners[${i}]`
    if (!isObject(c)) return push(path, '期望为对象')
    if (!isNonEmptyString(c.id)) push(`${path}.id`, '期望为非空字符串')
    else unique(cleanerIds, c.id, `${path}.id`)
    if (!isNonEmptyString(c.name)) push(`${path}.name`, '期望为非空字符串')
    if (!isNonEmptyString(c.phone_masked)) push(`${path}.phone_masked`, '期望为脱敏字符串')
    if (!districtIds.has(c.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!inEnum(c.employment, EMPLOYMENT_TYPES)) push(`${path}.employment`, '非法用工类型')
    if (!isInteger(c.hourly_rate) || c.hourly_rate < 0) {
      push(`${path}.hourly_rate`, '期望为非负整数分/小时')
    }
    if (!isNumber(c.base_rate) || c.base_rate < 0 || c.base_rate > 1) {
      push(`${path}.base_rate`, '期望位于 [0,1]')
    }
    if (
      c.quality_coef_override !== null &&
      c.quality_coef_override !== undefined &&
      !isNumber(c.quality_coef_override)
    ) {
      push(`${path}.quality_coef_override`, '期望为数字或 null')
    }
    if (!isNonEmptyString(c.hire_date)) push(`${path}.hire_date`, '期望为日期字符串')
    if (!inEnum(c.status, CLEANER_STATUS)) push(`${path}.status`, '非法阿姨状态')
  })

  /* --------------------------- customers -------------------------- */
  data.customers.forEach((c, i) => {
    const path = `customers[${i}]`
    if (!isObject(c)) return push(path, '期望为对象')
    if (!isNonEmptyString(c.id)) push(`${path}.id`, '期望为非空字符串')
    else unique(customerIds, c.id, `${path}.id`)
    if (!isNonEmptyString(c.name)) push(`${path}.name`, '期望为非空字符串')
    if (!isNonEmptyString(c.phone_masked)) push(`${path}.phone_masked`, '期望为脱敏字符串')
    if (!districtIds.has(c.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!isNonEmptyString(c.address)) push(`${path}.address`, '期望为非空字符串')
    if (!isNullableString(c.first_order_at)) push(`${path}.first_order_at`, '期望为字符串或 null')
    if (!isNullableString(c.last_order_at)) push(`${path}.last_order_at`, '期望为字符串或 null')
    for (const field of [
      'total_orders',
      'total_amount',
      'complaint_count',
      'compensation_amount',
    ]) {
      if (!isInteger(c[field]) || c[field] < 0) {
        push(`${path}.${field}`, '期望为非负整数')
      }
    }
    if (!inEnum(c.status, CUSTOMER_STATUS)) push(`${path}.status`, '非法客户状态')
    if (c.tags !== undefined && !isStringArray(c.tags)) push(`${path}.tags`, '期望为字符串数组')
  })

  /* --------------------------- orders ----------------------------- */
  data.orders.forEach((o, i) => {
    const path = `orders[${i}]`
    if (!isObject(o)) return push(path, '期望为对象')
    if (!isNonEmptyString(o.id)) push(`${path}.id`, '期望为非空字符串')
    else unique(orderIds, o.id, `${path}.id`)
    if (!isNonEmptyString(o.order_no)) push(`${path}.order_no`, '期望为非空字符串')
    if (!districtIds.has(o.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!customerIds.has(o.customer_id)) push(`${path}.customer_id`, '引用的客户不存在')
    if (!cleanerIds.has(o.cleaner_id)) push(`${path}.cleaner_id`, '引用的阿姨不存在')
    if (!inEnum(o.service_type, SERVICE_TYPES)) push(`${path}.service_type`, '非法服务类型')
    if (!isInteger(o.amount) || o.amount <= 0) {
      push(`${path}.amount`, '期望为正整数分')
    }
    if (!inEnum(o.status, ORDER_STATUS)) push(`${path}.status`, '非法工单状态')
    if (!isNonEmptyString(o.scheduled_at)) push(`${path}.scheduled_at`, '期望为时间字符串')
    if (!isNullableString(o.checkin_at)) push(`${path}.checkin_at`, '期望为时间字符串或 null')
    if (!isNullableString(o.completed_at)) push(`${path}.completed_at`, '期望为时间字符串或 null')
    if (o.photos_before !== undefined && !isStringArray(o.photos_before)) {
      push(`${path}.photos_before`, '期望为字符串数组')
    }
    if (o.photos_after !== undefined && !isStringArray(o.photos_after)) {
      push(`${path}.photos_after`, '期望为字符串数组')
    }
    if (!isNullableString(o.signature)) push(`${path}.signature`, '期望为字符串或 null')
    if (!isBoolean(o.is_rework)) push(`${path}.is_rework`, '期望为布尔值')
    if (!isNullableString(o.rework_of_order_id)) {
      push(`${path}.rework_of_order_id`, '期望为字符串或 null')
    }
    if (!isNullableString(o.cancel_reason)) push(`${path}.cancel_reason`, '期望为字符串或 null')
    if (!isNonEmptyString(o.idempotency_key)) {
      push(`${path}.idempotency_key`, '期望为非空字符串')
    }
    if (!isNonEmptyString(o.created_by)) push(`${path}.created_by`, '期望为非空字符串')
    if (!isNonEmptyString(o.created_at)) push(`${path}.created_at`, '期望为时间字符串')
    if (!isNonEmptyString(o.updated_at)) push(`${path}.updated_at`, '期望为时间字符串')
    if (o.status === 'completed' || o.status === 'closed') {
      if (!o.completed_at) push(`${path}.completed_at`, '完成/关闭单必须有 completed_at')
      if (!o.checkin_at) push(`${path}.checkin_at`, '完成/关闭单必须有 checkin_at')
    }
  })

  /* ------------------------ compensations ------------------------- */
  data.compensations.forEach((c, i) => {
    const path = `compensations[${i}]`
    if (!isObject(c)) return push(path, '期望为对象')
    if (!isNonEmptyString(c.id)) push(`${path}.id`, '期望为非空字符串')
    else unique(compensationIds, c.id, `${path}.id`)
    if (!orderIds.has(c.order_id)) push(`${path}.order_id`, '引用的工单不存在')
    if (!districtIds.has(c.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!inEnum(c.reason, COMPENSATION_REASONS)) push(`${path}.reason`, '非法赔付原因')
    if (!inEnum(c.responsibility, RESPONSIBILITIES)) {
      push(`${path}.responsibility`, '非法责任方')
    }
    if (!isInteger(c.amount) || c.amount <= 0) push(`${path}.amount`, '期望为正整数分')
    if (!isInteger(c.evidence_score) || c.evidence_score < 0 || c.evidence_score > 100) {
      push(`${path}.evidence_score`, '期望位于 [0,100]')
    }
    if (!isStringArray(c.evidence_refs)) push(`${path}.evidence_refs`, '期望为字符串数组')
    if (!inEnum(c.status, COMPENSATION_STATUS)) push(`${path}.status`, '非法赔付状态')
    if (!Array.isArray(c.approver_chain)) push(`${path}.approver_chain`, '期望为数组')
    if (!isNullableString(c.decided_at)) push(`${path}.decided_at`, '期望为时间字符串或 null')
    if (!isNullableString(c.approved_at)) push(`${path}.approved_at`, '期望为时间字符串或 null')
    if (c.status === 'approved' && !c.approved_at) {
      push(`${path}.approved_at`, '已审批赔付必须有 approved_at')
    }
    if (!isNullableString(c.appeal_note)) push(`${path}.appeal_note`, '期望为字符串或 null')
    if (!isNonEmptyString(c.idempotency_key)) {
      push(`${path}.idempotency_key`, '期望为非空字符串')
    }
    if (!isInteger(c.version) || c.version < 1) push(`${path}.version`, '期望为 ≥1 的整数')
  })

  /* -------------------------- complaints -------------------------- */
  data.complaints.forEach((c, i) => {
    const path = `complaints[${i}]`
    if (!isObject(c)) return push(path, '期望为对象')
    if (!isNonEmptyString(c.id)) push(`${path}.id`, '期望为非空字符串')
    if (!orderIds.has(c.order_id)) push(`${path}.order_id`, '引用的工单不存在')
    if (!customerIds.has(c.customer_id)) push(`${path}.customer_id`, '引用的客户不存在')
    if (!districtIds.has(c.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!inEnum(c.channel, COMPLAINT_CHANNELS)) push(`${path}.channel`, '非法投诉渠道')
    if (!inEnum(c.category, COMPLAINT_CATEGORIES)) push(`${path}.category`, '非法投诉分类')
    if (!isNonEmptyString(c.content)) push(`${path}.content`, '期望为非空字符串')
    if (!inEnum(c.status, COMPLAINT_STATUS)) push(`${path}.status`, '非法投诉状态')
    if (!isNullableString(c.compensation_id)) {
      push(`${path}.compensation_id`, '期望为字符串或 null')
    } else if (c.compensation_id !== null && !compensationIds.has(c.compensation_id)) {
      push(`${path}.compensation_id`, '引用的赔付不存在')
    }
    if (!isNonEmptyString(c.created_at)) push(`${path}.created_at`, '期望为时间字符串')
    if (!isNullableString(c.resolved_at)) push(`${path}.resolved_at`, '期望为时间字符串或 null')
  })

  /* --------------------------- reworks ---------------------------- */
  data.reworks.forEach((r, i) => {
    const path = `reworks[${i}]`
    if (!isObject(r)) return push(path, '期望为对象')
    if (!isNonEmptyString(r.id)) push(`${path}.id`, '期望为非空字符串')
    if (!orderIds.has(r.order_id)) push(`${path}.order_id`, '引用的原单不存在')
    if (!orderIds.has(r.rework_order_id)) push(`${path}.rework_order_id`, '引用的返工单不存在')
    if (!isNonEmptyString(r.reason)) push(`${path}.reason`, '期望为非空字符串')
    if (!isInteger(r.cost) || r.cost < 0) push(`${path}.cost`, '期望为非负整数分')
    if (!isNonEmptyString(r.created_at)) push(`${path}.created_at`, '期望为时间字符串')
  })

  /* -------------------------- idleRuns ---------------------------- */
  data.idleRuns.forEach((r, i) => {
    const path = `idleRuns[${i}]`
    if (!isObject(r)) return push(path, '期望为对象')
    if (!isNonEmptyString(r.id)) push(`${path}.id`, '期望为非空字符串')
    if (!orderIds.has(r.order_id)) push(`${path}.order_id`, '引用的工单不存在')
    if (!inEnum(r.type, IDLE_RUN_TYPES)) push(`${path}.type`, '非法空跑类型')
    if (!isInteger(r.cost) || r.cost < 0) push(`${path}.cost`, '期望为非负整数分')
    if (!isNonEmptyString(r.reason)) push(`${path}.reason`, '期望为非空字符串')
    if (!isNonEmptyString(r.created_at)) push(`${path}.created_at`, '期望为时间字符串')
  })

  /* ------------------------- settlements -------------------------- */
  data.settlements.forEach((s, i) => {
    const path = `settlements[${i}]`
    if (!isObject(s)) return push(path, '期望为对象')
    if (!isNonEmptyString(s.id)) push(`${path}.id`, '期望为非空字符串')
    if (!PERIOD_RE.test(s.period || '')) push(`${path}.period`, '期望为 YYYY-MM')
    if (!cleanerIds.has(s.cleaner_id)) push(`${path}.cleaner_id`, '引用的阿姨不存在')
    if (s.order_id !== null && !orderIds.has(s.order_id)) {
      push(`${path}.order_id`, '引用的工单不存在')
    }
    for (const field of ['minutes', 'base_pay', 'quality_pay', 'total']) {
      if (!isInteger(s[field]) || s[field] < 0) push(`${path}.${field}`, '期望为非负整数')
    }
    if (!inEnum(s.status, SETTLEMENT_STATUS)) push(`${path}.status`, '非法结算状态')
  })

  /* ------------------------ monthlySummary ------------------------ */
  data.monthlySummary.forEach((m, i) => {
    const path = `monthlySummary[${i}]`
    if (!isObject(m)) return push(path, '期望为对象')
    if (!districtIds.has(m.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!PERIOD_RE.test(m.period || '')) push(`${path}.period`, '期望为 YYYY-MM')
    for (const field of [
      'revenue',
      'direct_cost',
      'compensation',
      'rework_cost',
      'idle_run_cost',
      'fixed_cost',
      'net_profit',
    ]) {
      if (!isInteger(m[field])) push(`${path}.${field}`, '期望为整数分')
    }
  })

  /* ------------------------- periodOpening ------------------------ */
  data.periodOpening.forEach((p, i) => {
    const path = `periodOpening[${i}]`
    if (!isObject(p)) return push(path, '期望为对象')
    if (!districtIds.has(p.district_id)) push(`${path}.district_id`, '引用的片区不存在')
    if (!PERIOD_RE.test(p.period || '')) push(`${path}.period`, '期望为 YYYY-MM')
    if (!isInteger(p.opening_balance)) push(`${path}.opening_balance`, '期望为整数分')
  })

  /* ------------------------------ meta ---------------------------- */
  if (isObject(data.meta)) {
    if (!isNonEmptyString(data.meta.seedId)) push('meta.seedId', '期望为非空字符串')
    if (!PERIOD_RE.test(data.meta.period || '')) push('meta.period', '期望为 YYYY-MM')
    if (!isBoolean(data.meta.seedLoaded)) push('meta.seedLoaded', '期望为布尔值')
  }

  return { ok: errors.length === 0, errors }
}

export default validateSeed
