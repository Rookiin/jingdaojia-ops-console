/**
 * 工单列表筛选（纯函数，便于单测；页面只负责渲染）。
 */

export const EMPTY_ORDER_FILTERS = {
  district: '',
  status: '',
  service: '',
  keyword: '',
  reworkOnly: false,
  hasComplaint: false,
}

/**
 * 建立「工单 → 投诉」索引：投诉条数、最新一条与全部内容文本。
 * @param {Array<Object>} complaints
 * @returns {Map<string, {count:number, latest:Object|null, contents:string[]}>}
 */
export function buildComplaintIndex(complaints) {
  const index = new Map()
  for (const complaint of Array.isArray(complaints) ? complaints : []) {
    if (!complaint || !complaint.order_id) continue
    const entry = index.get(complaint.order_id) || { count: 0, latest: null, contents: [] }
    entry.count += 1
    entry.contents.push(String(complaint.content || ''))
    const latestAt = entry.latest?.created_at || ''
    const currentAt = complaint.created_at || ''
    if (!entry.latest || currentAt >= latestAt) entry.latest = complaint
    index.set(complaint.order_id, entry)
  }
  return index
}

function haystackFor(order, customerById, cleanerById, complaintIndex) {
  const customer = customerById?.get(order.customer_id)
  const cleaner = cleanerById?.get(order.cleaner_id)
  const complaint = complaintIndex?.get(order.id)
  return [
    order.order_no,
    order.id,
    customer?.name,
    cleaner?.name,
    ...(complaint ? complaint.contents : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * 按筛选条件过滤工单；关键词同时匹配单号、客户、阿姨与投诉内容。
 * @param {{orders:Array<Object>, filters:Object, customerById:Map, cleanerById:Map,
 *   complaintIndex:Map}} input
 * @returns {Array<Object>}
 */
export function filterOrders({ orders, filters, customerById, cleanerById, complaintIndex }) {
  const f = { ...EMPTY_ORDER_FILTERS, ...(filters || {}) }
  const keyword = String(f.keyword || '').trim().toLowerCase()

  return (Array.isArray(orders) ? orders : []).filter((order) => {
    if (!order) return false
    if (f.district && order.district_id !== f.district) return false
    if (f.status && order.status !== f.status) return false
    if (f.service && order.service_type !== f.service) return false
    if (f.reworkOnly && !order.is_rework) return false
    if (f.hasComplaint && !complaintIndex?.has(order.id)) return false
    if (keyword) {
      if (!haystackFor(order, customerById, cleanerById, complaintIndex).includes(keyword)) {
        return false
      }
    }
    return true
  })
}
