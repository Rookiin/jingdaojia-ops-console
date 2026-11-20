import { describe, expect, it } from 'vitest'
import {
  EMPTY_ORDER_FILTERS,
  buildComplaintIndex,
  filterOrders,
} from '../filters.js'

const CUSTOMERS = new Map([
  ['K-1', { id: 'K-1', name: '刘先生' }],
  ['K-2', { id: 'K-2', name: '卢女士' }],
])
const CLEANERS = new Map([
  ['C-1', { id: 'C-1', name: '韦秀兰' }],
  ['C-2', { id: 'C-2', name: '覃俊' }],
])

const ORDERS = [
  {
    id: 'O-1',
    order_no: 'NJ2026100001',
    district_id: 'D-XXT',
    customer_id: 'K-1',
    cleaner_id: 'C-1',
    service_type: 'deep',
    status: 'completed',
    is_rework: false,
  },
  {
    id: 'O-2',
    order_no: 'NJ2026100002',
    district_id: 'D-QX',
    customer_id: 'K-2',
    cleaner_id: 'C-2',
    service_type: 'daily',
    status: 'completed',
    is_rework: true,
  },
  {
    id: 'O-3',
    order_no: 'NJ2026100003',
    district_id: 'D-XXT',
    customer_id: 'K-1',
    cleaner_id: 'C-1',
    service_type: 'daily',
    status: 'closed',
    is_rework: false,
  },
]

const COMPLAINTS = [
  {
    id: 'CPT-1',
    order_id: 'O-1',
    category: 'damage',
    content: '客户反馈服务后发现物品表面损伤',
    created_at: '2026-10-05T10:00:00+08:00',
  },
  {
    id: 'CPT-2',
    order_id: 'O-1',
    category: 'attitude',
    content: '客户反馈沟通态度不好',
    created_at: '2026-10-06T10:00:00+08:00',
  },
  {
    id: 'CPT-3',
    order_id: 'O-2',
    category: 'late',
    content: '阿姨迟到四十分钟',
    created_at: '2026-10-07T10:00:00+08:00',
  },
]

function run(filters = {}, orders = ORDERS, complaints = COMPLAINTS) {
  return filterOrders({
    orders,
    filters: { ...EMPTY_ORDER_FILTERS, ...filters },
    customerById: CUSTOMERS,
    cleanerById: CLEANERS,
    complaintIndex: buildComplaintIndex(complaints),
  })
}

describe('orders/filters（投诉检索）', () => {
  it('无筛选返回全部', () => {
    expect(run()).toHaveLength(3)
  })

  it('仅看有投诉：只保留有投诉的工单', () => {
    const ids = run({ hasComplaint: true }).map((order) => order.id)
    expect(ids).toEqual(['O-1', 'O-2'])
  })

  it('关键词可匹配投诉内容', () => {
    expect(run({ keyword: '态度' }).map((o) => o.id)).toEqual(['O-1'])
    expect(run({ keyword: '迟到' }).map((o) => o.id)).toEqual(['O-2'])
  })

  it('关键词仍匹配单号 / 客户 / 阿姨', () => {
    expect(run({ keyword: 'NJ2026100003' }).map((o) => o.id)).toEqual(['O-3'])
    expect(run({ keyword: '刘先生' }).map((o) => o.id)).toEqual(['O-1', 'O-3'])
    expect(run({ keyword: '覃俊' }).map((o) => o.id)).toEqual(['O-2'])
  })

  it('投诉筛选与片区 / 返工 / 状态可叠加', () => {
    expect(run({ hasComplaint: true, district: 'D-XXT' }).map((o) => o.id)).toEqual(['O-1'])
    expect(run({ hasComplaint: true, reworkOnly: true }).map((o) => o.id)).toEqual(['O-2'])
    expect(run({ hasComplaint: true, status: 'closed' })).toEqual([])
    expect(run({ hasComplaint: true, keyword: '态度' }).map((o) => o.id)).toEqual(['O-1'])
  })

  it('buildComplaintIndex 统计条数并取最新一条', () => {
    const index = buildComplaintIndex(COMPLAINTS)
    expect(index.get('O-1').count).toBe(2)
    expect(index.get('O-1').latest.id).toBe('CPT-2')
    expect(index.get('O-1').contents).toHaveLength(2)
    expect(index.has('O-3')).toBe(false)

    const empty = buildComplaintIndex(null)
    expect(empty.size).toBe(0)
  })

  it('空输入安全返回空数组', () => {
    expect(
      filterOrders({
        orders: null,
        filters: null,
        customerById: CUSTOMERS,
        cleanerById: CLEANERS,
        complaintIndex: new Map(),
      }),
    ).toEqual([])
  })
})
