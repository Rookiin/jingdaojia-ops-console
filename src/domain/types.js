/**
 * 领域枚举与 JSDoc 类型单一事实源。
 *
 * 说明：本项目为纯 JavaScript，不引入 TypeScript；本文件用 JSDoc 描述实体形状，
 * 供 domain / data / store 层引用，避免字符串魔法值散落。
 */

/** 片区类型 */
export const DISTRICT_KINDS = ['urban', 'county']

/** 片区状态 */
export const DISTRICT_STATUS = ['active', 'config_only']

/** 阿姨用工类型 */
export const EMPLOYMENT_TYPES = ['fulltime', 'parttime']

/** 阿姨状态 */
export const CLEANER_STATUS = ['active', 'inactive']

/** 客户状态 */
export const CUSTOMER_STATUS = ['active', 'churn_risk', 'churned']

/** 服务类型 */
export const SERVICE_TYPES = ['daily', 'deep', 'opening']

/** 工单状态机 */
export const ORDER_STATUS = [
  'created',
  'assigned',
  'checked_in',
  'completed',
  'closed',
  'cancelled',
  'voided',
]

/** 合法工单状态迁移（不可跳步） */
export const ORDER_TRANSITIONS = {
  created: ['assigned', 'cancelled'],
  assigned: ['checked_in', 'cancelled'],
  checked_in: ['completed'],
  completed: ['closed', 'voided'],
  closed: ['voided'],
  cancelled: [],
  voided: [],
}

/** 赔付原因 */
export const COMPENSATION_REASONS = ['wash_damage', 'scratch', 'lost', 'other']

/** 赔付责任方 */
export const RESPONSIBILITIES = [
  'cleaner',
  'customer',
  'product',
  'none',
  'undetermined',
]

/** 赔付状态 */
export const COMPENSATION_STATUS = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'reversed',
]

/** 投诉渠道 */
export const COMPLAINT_CHANNELS = ['phone', 'wechat', 'app']

/** 投诉分类 */
export const COMPLAINT_CATEGORIES = [
  'damage',
  'late',
  'quality',
  'attitude',
  'other',
]

/** 投诉状态 */
export const COMPLAINT_STATUS = ['open', 'processing', 'resolved', 'closed']

/** 空跑记录类型 */
export const IDLE_RUN_TYPES = ['idle', 'reschedule']

/** 结算状态 */
export const SETTLEMENT_STATUS = ['draft', 'locked', 'reversed']

/** 审批层级 */
export const APPROVAL_ROLES = ['district_manager', 'finance']

/**
 * @typedef {number} Cents 整数分
 * @typedef {number} Ratio 0–1 之间比例
 *
 * @typedef {Object} District
 * @property {string} id
 * @property {string} name
 * @property {'urban'|'county'} kind
 * @property {string} manager
 * @property {Cents} fixed_cost_monthly
 * @property {number} direct_cost_rate
 * @property {boolean} is_pilot
 * @property {'active'|'config_only'} status
 *
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} order_no
 * @property {string} district_id
 * @property {string} customer_id
 * @property {string} cleaner_id
 * @property {'daily'|'deep'|'opening'} service_type
 * @property {Cents} amount
 * @property {string} status
 * @property {string} scheduled_at
 * @property {string|null} checkin_at
 * @property {string|null} completed_at
 * @property {boolean} is_rework
 */
