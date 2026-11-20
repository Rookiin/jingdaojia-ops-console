/**
 * 确定性种子生成器（自写 LCG，固定 seed）。
 *
 * 边界声明：本文件生成的全部片区、阿姨、客户、工单、赔付、投诉、返工、空跑、
 * 结算与月度汇总数据均为**教学虚构**，不含真实客户信息、账号或凭据。
 * 姓名、电话（已脱敏）、地址均为占位；金额单位为**分**。
 *
 * 规模（docs §2.4）：
 * - 8 片区（2 个 pilot：西乡塘、青秀；6 个 config_only）
 * - 98 阿姨（西 33 / 青 65）
 * - 1,200 客户（西 400 / 青 800）
 * - 120 赔付（72 已审批 + 48 待定，无法定责率 40%）
 *
 * 规模偏差（有意简化）：docs §2.4 要求 5,200 单/月（西 1,733 + 青 3,467）。
 * 为把 localStorage 载荷压在 ~1.7M 字符内（避免 5MB 配额风险、加快首屏），
 * 工单明细降为 1,800 单/月（西 600 = 510 正常 + 90 返工；青 1,200）；
 * 另加 6 张 2026-11 的「在途任务」供阿姨端演示（assigned/checked_in，不计营收），
 * 合计 1,806 单。其余规模（8 片区 / 98 阿姨 / 1,200 客户 / 120 赔付 /
 * 180 投诉 / 90 返工 / 60 空跑）与 docs 一致，损益 aggregate 与验收值**完全不变**。
 * - 180 投诉、90 返工、60 空跑
 *
 * 金额闭合（全部为分，误差 0）：
 *   西乡塘：营收 26,000,000 − 直接成本 20,280,000 − 赔付 1,400,000
 *           − 返工 1,300,000 − 空跑 680,000 − 固定 5,000,000 = −2,660,000
 *   青秀：  营收 52,000,000 − 直接成本 40,560,000 − 固定 9,000,000 = +2,440,000
 *
 * 说明：本文件不读写 localStorage、不依赖 React、不调用 Date.now()/Math.random()。
 * 所有随机数来自固定种子的 LCG，同一版本构建结果完全一致。
 */
import { monthSequence } from '../domain/period.js'
import { roundCents } from '../domain/money.js'

export const SEED_ID = 'njdao-seed-2026-10-v1'
export const SEED_PERIOD = '2026-10'
export const SEED_RANDOM_SEED = 20261031

export const SEED_SCALE = {
  districts: 8,
  cleaners: 98,
  customers: 1200,
  // 演示规模：docs 目标 5,200，降至 1,800 以控制 localStorage 体积；
  // 营收由最大余数法精确分配，aggregate 不受单量影响。
  // +6 张 2026-11 在途任务（阿姨端打卡演示），不计营收。
  orders: 1806,
  fieldTasks: 6,
  westOrders: 600,
  westEligibleOrders: 510,
  westReworkOrders: 90,
  qingxiuOrders: 1200,
  docsTargetOrders: 5200,
  compensations: 120,
  undeterminedCompensations: 48,
  complaints: 180,
  reworks: 90,
  idleRuns: 60,
}

/**
 * 验收目标（分）。测试直接断言这些数字。
 */
export const SEED_TARGETS = {
  period: SEED_PERIOD,
  xiangtang: {
    districtId: 'D-XXT',
    revenue: 26_000_000,
    directCost: 20_280_000,
    compensation: 1_400_000,
    reworkCost: 1_300_000,
    idleRunCost: 680_000,
    fixedCost: 5_000_000,
    leakTotal: 3_380_000,
    netProfit: -2_660_000,
    grossProfit: 5_720_000,
  },
  qingxiu: {
    districtId: 'D-QX',
    revenue: 52_000_000,
    directCost: 40_560_000,
    compensation: 0,
    reworkCost: 0,
    idleRunCost: 0,
    fixedCost: 9_000_000,
    leakTotal: 0,
    netProfit: 2_440_000,
    grossProfit: 11_440_000,
  },
}

/**
 * 片区演示中心坐标（虚构，仅用于阿姨端定位围栏演示，非真实地理编码）。
 */
export const DISTRICT_CENTERS = {
  'D-XXT': { lat: 22.8386, lng: 108.2861 },
  'D-QX': { lat: 22.8167, lng: 108.3667 },
}

/** 阿姨端演示日期：在途任务所在当天。 */
export const FIELD_DEMO_DATE = '2026-11-02'

/* ------------------------------------------------------------------ */
/* 确定性随机与工具                                                    */
/* ------------------------------------------------------------------ */

function makeRng(seed) {
  let s = seed >>> 0
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function shuffle(rng, arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isoAt(day, minutesOfDay) {
  const d = Math.min(31, Math.max(1, day))
  const m = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${SEED_PERIOD}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00+08:00`
}

function dayOf(iso) {
  return Number(String(iso).slice(8, 10)) || 1
}

function minutesBetween(startIso, endIso) {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 30
  return Math.max(0, Math.round((end - start) / 60000))
}

/**
 * 最大余数法：把整数 total 按权重拆成整数数组，保证 sum 精确等于 total。
 * @param {number} total
 * @param {number[]} weights
 * @returns {number[]}
 */
function allocateCents(total, weights) {
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map((w) => (total * w) / weightSum)
  const base = raw.map((v) => Math.floor(v))
  let remainder = total - base.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, index) => ({ index, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index)
  let cursor = 0
  while (remainder > 0) {
    base[order[cursor % order.length].index] += 1
    remainder -= 1
    cursor += 1
  }
  return base
}

function maskedPhone(seq) {
  return `138****${String(seq % 10000).padStart(4, '0')}`
}

/* ------------------------------------------------------------------ */
/* 基础字典                                                            */
/* ------------------------------------------------------------------ */

const SURNAMES = [
  '李', '黄', '梁', '韦', '陆', '覃', '周', '刘', '陈', '杨',
  '吴', '赵', '卢', '农', '蒙', '邓', '钟', '莫', '张', '林',
]
const FEMALE_GIVEN = [
  '秀兰', '桂芳', '丽娟', '海燕', '春梅', '小玲', '玉珍', '金凤', '雪梅', '红霞',
  '月兰', '美华', '冬梅', '慧敏', '晓燕', '丹', '萍', '静', '芳', '燕',
]
const MALE_GIVEN = [
  '建国', '志强', '海波', '伟明', '军', '磊', '勇', '涛', '斌', '辉',
  '文杰', '俊', '平', '刚', '峰', '飞', '宁', '鹏', '浩', '宇',
]

const SERVICE_WEIGHT = { daily: 0.68, deep: 0.22, opening: 0.1 }
const SERVICE_VALUE_WEIGHT = { daily: 1, deep: 1.9, opening: 2.8 }

function pickServiceType(rng) {
  const r = rng()
  if (r < SERVICE_WEIGHT.daily) return 'daily'
  if (r < SERVICE_WEIGHT.daily + SERVICE_WEIGHT.deep) return 'deep'
  return 'opening'
}

const ORDER_REASONS = [
  '清洁不彻底，客户要求返工',
  '服务后出现轻微划痕',
  '遗漏厨房区域',
  '玻璃留水痕',
]

const IDLE_REASONS = [
  '客户临时改约，阿姨已到楼下',
  '门禁无法进入，等待超时',
  '客户家中无人，空跑',
  '地址信息错误，调度交通',
]

const COMP_REASONS = ['wash_damage', 'scratch', 'lost', 'other']
const COMPLAINT_CHANNELS = ['phone', 'wechat', 'app']
const COMPLAINT_CATEGORIES = ['damage', 'late', 'quality', 'attitude', 'other']

/* ------------------------------------------------------------------ */
/* 主生成器                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成完整种子状态片段。
 * @returns {Object} state 片段（districts / cleaners / … / meta）
 */
export function buildSeed() {
  const rng = makeRng(SEED_RANDOM_SEED)

  /* -------------------------- 片区 -------------------------- */
  const districts = [
    {
      id: 'D-XXT',
      name: '西乡塘',
      kind: 'urban',
      manager: '陆明',
      fixed_cost_monthly: 5_000_000,
      direct_cost_rate: 0.78,
      is_pilot: true,
      status: 'active',
    },
    {
      id: 'D-QX',
      name: '青秀',
      kind: 'urban',
      manager: '黄岚',
      fixed_cost_monthly: 9_000_000,
      direct_cost_rate: 0.78,
      is_pilot: true,
      status: 'active',
    },
    ...['兴宁', '江南', '良庆', '邕宁', '武鸣', '马山'].map((name, idx) => ({
      id: `D-CFG${idx + 1}`,
      name,
      kind: idx >= 4 ? 'county' : 'urban',
      manager: ['周伟', '梁静', '韦强', '覃芳', '农军', '莫平'][idx],
      // config_only 片区尚未开城，不产生固定成本与明细
      fixed_cost_monthly: 0,
      direct_cost_rate: 0.78,
      is_pilot: false,
      status: 'config_only',
    })),
  ]

  /* -------------------------- 阿姨 -------------------------- */
  const cleaners = []
  let cleanerSeq = 0
  const cleanerPlan = [
    { district_id: 'D-XXT', count: 33 },
    { district_id: 'D-QX', count: 65 },
  ]
  for (const plan of cleanerPlan) {
    for (let i = 0; i < plan.count; i += 1) {
      cleanerSeq += 1
      const female = cleanerSeq % 5 !== 0
      const given = female ? pick(rng, FEMALE_GIVEN) : pick(rng, MALE_GIVEN)
      const surname = pick(rng, SURNAMES)
      cleaners.push({
        id: `C-${String(cleanerSeq).padStart(4, '0')}`,
        name: `${surname}${given}`,
        phone_masked: maskedPhone(8000 + cleanerSeq),
        district_id: plan.district_id,
        employment: cleanerSeq % 4 === 0 ? 'parttime' : 'fulltime',
        hourly_rate: cleanerSeq % 11 === 0 ? 3000 : cleanerSeq % 7 === 0 ? 2800 : 2500,
        base_rate: 0.15,
        quality_coef_override: cleanerSeq % 49 === 0 ? 1.1 : null,
        hire_date: `202${3 + (cleanerSeq % 2)}-${pad2((cleanerSeq % 12) + 1)}-${pad2((cleanerSeq % 27) + 1)}`,
        status: cleanerSeq > 95 ? 'inactive' : 'active',
      })
    }
  }
  const westCleaners = cleaners.filter((c) => c.district_id === 'D-XXT')
  const qingxiuCleaners = cleaners.filter((c) => c.district_id === 'D-QX')

  /* -------------------------- 客户 -------------------------- */
  const customers = []
  let customerSeq = 0
  const customerPlan = [
    { district_id: 'D-XXT', count: 400 },
    { district_id: 'D-QX', count: 800 },
  ]
  for (const plan of customerPlan) {
    const districtName = plan.district_id === 'D-XXT' ? '西乡塘' : '青秀'
    for (let i = 0; i < plan.count; i += 1) {
      customerSeq += 1
      const surname = pick(rng, SURNAMES)
      const center = DISTRICT_CENTERS[plan.district_id]
      const offsetLat = (((customerSeq * 37) % 21) - 10) * 0.0004
      const offsetLng = (((customerSeq * 53) % 21) - 10) * 0.0004
      customers.push({
        id: `K-${String(customerSeq).padStart(4, '0')}`,
        name: `${surname}${customerSeq % 2 === 0 ? '女士' : '先生'}`,
        phone_masked: maskedPhone(customerSeq),
        district_id: plan.district_id,
        address: `南宁市${districtName}示例路${(customerSeq % 120) + 1}号（虚构）`,
        // 虚构坐标：片区中心 + 确定性小偏移（≤±0.004°，约 440 米内）
        lat: Number((center.lat + offsetLat).toFixed(6)),
        lng: Number((center.lng + offsetLng).toFixed(6)),
        first_order_at: null,
        last_order_at: null,
        total_orders: 0,
        total_amount: 0,
        complaint_count: 0,
        compensation_amount: 0,
        status: 'active',
        tags: [],
      })
    }
  }
  const westCustomers = customers.filter((c) => c.district_id === 'D-XXT')
  const qingxiuCustomers = customers.filter((c) => c.district_id === 'D-QX')

  /* -------------------------- 工单 -------------------------- */
  let orderSeq = 0

  function makeEligibleOrders({ districtId, customerPool, cleanerPool, count }) {
    const result = []
    for (let i = 0; i < count; i += 1) {
      orderSeq += 1
      const id = `O-${String(orderSeq).padStart(6, '0')}`
      const serviceType = pickServiceType(rng)
      const day = randInt(rng, 1, 26)
      const startMinutes = randInt(rng, 8 * 60, 16 * 60 + 45)
      const duration = pick(rng, [60, 90, 120, 150, 180, 240])
      const lateMinutes = randInt(rng, 0, 20)
      const checkinMinutes = startMinutes + lateMinutes
      const completedMinutes = checkinMinutes + duration
      const customer = pick(rng, customerPool)
      const cleaner = pick(rng, cleanerPool)
      const status = rng() < 0.55 ? 'completed' : 'closed'
      const hasBefore = rng() < 0.86
      const hasAfter = rng() < 0.9
      const hasSignature = rng() < 0.88

      result.push({
        id,
        order_no: `NJ202610${String(orderSeq).padStart(4, '0')}`,
        district_id: districtId,
        customer_id: customer.id,
        cleaner_id: cleaner.id,
        service_type: serviceType,
        amount: 0, // 稍后按营收目标分配
        status,
        scheduled_at: isoAt(day, startMinutes),
        checkin_at: isoAt(day, checkinMinutes),
        completed_at: isoAt(day, completedMinutes),
        photos_before: hasBefore ? [`mock://b/${id}`] : [],
        photos_after: hasAfter ? [`mock://a/${id}`] : [],
        signature: hasSignature ? `sig://${id}` : null,
        is_rework: false,
        rework_of_order_id: null,
        cancel_reason: null,
        idempotency_key: `create:${id}`,
        created_by: `DISPATCH-${districtId}`,
        created_at: isoAt(day, Math.max(0, startMinutes - 150)),
        updated_at: isoAt(day, completedMinutes),
        _valueWeight:
          SERVICE_VALUE_WEIGHT[serviceType] * (0.75 + rng() * 0.5),
      })
      result[result.length - 1]._day = day
    }
    return result
  }

  const westEligible = makeEligibleOrders({
    districtId: 'D-XXT',
    customerPool: westCustomers,
    cleanerPool: westCleaners,
    count: SEED_SCALE.westEligibleOrders,
  })
  const qingxiuEligible = makeEligibleOrders({
    districtId: 'D-QX',
    customerPool: qingxiuCustomers,
    cleanerPool: qingxiuCleaners,
    count: SEED_SCALE.qingxiuOrders,
  })

  // 分配营收精确值
  const westAmounts = allocateCents(
    SEED_TARGETS.xiangtang.revenue,
    westEligible.map((o) => o._valueWeight),
  )
  westEligible.forEach((o, i) => {
    o.amount = westAmounts[i]
  })
  const qingxiuAmounts = allocateCents(
    SEED_TARGETS.qingxiu.revenue,
    qingxiuEligible.map((o) => o._valueWeight),
  )
  qingxiuEligible.forEach((o, i) => {
    o.amount = qingxiuAmounts[i]
  })

  // 90 个返工单（西乡塘），关联正常单
  const reworkOriginalPool = shuffle(rng, westEligible).slice(
    0,
    SEED_SCALE.westReworkOrders,
  )
  const westReworkOrders = []
  for (const original of reworkOriginalPool) {
    orderSeq += 1
    const id = `O-${String(orderSeq).padStart(6, '0')}`
    const day = Math.min(28, dayOf(original.completed_at) + randInt(rng, 0, 1))
    const startMinutes = randInt(rng, 9 * 60, 15 * 60)
    const duration = pick(rng, [60, 90, 120])
    westReworkOrders.push({
      id,
      order_no: `NJ202610${String(orderSeq).padStart(4, '0')}`,
      district_id: 'D-XXT',
      customer_id: original.customer_id,
      cleaner_id: original.cleaner_id,
      service_type: original.service_type,
      amount: randInt(rng, 6000, 14000),
      status: 'completed',
      scheduled_at: isoAt(day, startMinutes),
      checkin_at: isoAt(day, startMinutes),
      completed_at: isoAt(day, startMinutes + duration),
      photos_before: [`mock://b/${id}`],
      photos_after: [`mock://a/${id}`],
      signature: rng() < 0.7 ? `sig://${id}` : null,
      is_rework: true,
      rework_of_order_id: original.id,
      cancel_reason: null,
      idempotency_key: `create:${id}`,
      created_by: 'DISPATCH-D-XXT',
      created_at: isoAt(day, Math.max(0, startMinutes - 120)),
      updated_at: isoAt(day, startMinutes + duration),
      _day: day,
    })
  }

  /* --------- 阿姨端演示：2026-11 在途任务（assigned/checked_in，不计营收） --------- */
  const fieldTaskCleaners = cleaners.slice(0, 3)
  const fieldTaskCustomers = westCustomers.slice(0, 6)
  const fieldTasks = []
  fieldTaskCleaners.forEach((cleaner, ci) => {
    for (let slot = 0; slot < 2; slot += 1) {
      orderSeq += 1
      const id = `O-${String(orderSeq).padStart(6, '0')}`
      const customer = fieldTaskCustomers[ci * 2 + slot]
      const status = slot === 0 ? 'assigned' : 'checked_in'
      const startMinutes = 9 * 60 + ci * 30 + slot * 120
      const startAt = `${FIELD_DEMO_DATE}T${pad2(Math.floor(startMinutes / 60))}:${pad2(
        startMinutes % 60,
      )}:00+08:00`
      const checkinMinutes = startMinutes + 5
      const checkinAt =
        status === 'checked_in'
          ? `${FIELD_DEMO_DATE}T${pad2(Math.floor(checkinMinutes / 60))}:${pad2(
              checkinMinutes % 60,
            )}:00+08:00`
          : null
      const beforePhoto = `mock://b/${id}`
      const checkinEvent = checkinAt
        ? {
            id: `${id}:checkin`,
            type: 'checkin',
            order_id: id,
            at: checkinAt,
            operator: cleaner.id,
            location: { lat: customer.lat, lng: customer.lng, accuracy: 20 },
            distance_m: 0,
            photos: [beforePhoto],
          }
        : null

      fieldTasks.push({
        id,
        order_no: `NJ202611${String(ci * 2 + slot + 1).padStart(4, '0')}`,
        district_id: cleaner.district_id,
        customer_id: customer.id,
        cleaner_id: cleaner.id,
        service_type: 'daily',
        amount: 15_000 + ((orderSeq * 137) % 9) * 1_000,
        status,
        scheduled_at: startAt,
        checkin_at: checkinAt,
        completed_at: null,
        photos_before: status === 'checked_in' ? [beforePhoto] : [],
        photos_after: [],
        signature: null,
        signature_pending: false,
        is_rework: false,
        rework_of_order_id: null,
        cancel_reason: null,
        idempotency_key: `create:${id}`,
        created_by: `DISPATCH-${cleaner.district_id}`,
        created_at: '2026-11-01T18:00:00+08:00',
        updated_at: checkinAt || '2026-11-01T18:00:00+08:00',
        checkin_location: checkinAt
          ? {
              lat: customer.lat,
              lng: customer.lng,
              accuracy: 20,
              distance_m: 0,
              at: checkinAt,
            }
          : null,
        field_events: checkinEvent ? [checkinEvent] : [],
      })
    }
  })

  const orders = [
    ...westEligible,
    ...westReworkOrders,
    ...qingxiuEligible,
    ...fieldTasks,
  ]
  for (const o of orders) {
    delete o._valueWeight
    delete o._day
  }
  const orderById = new Map(orders.map((o) => [o.id, o]))

  /* -------------------------- 赔付 -------------------------- */
  const compCandidates = shuffle(rng, westEligible)
  const approvedCandidates = compCandidates.slice(
    0,
    SEED_SCALE.compensations - SEED_SCALE.undeterminedCompensations,
  )
  const pendingCandidates = compCandidates.slice(
    SEED_SCALE.compensations - SEED_SCALE.undeterminedCompensations,
    SEED_SCALE.compensations,
  )
  const approvedAmounts = allocateCents(
    SEED_TARGETS.xiangtang.compensation,
    approvedCandidates.map(() => 0.6 + rng() * 0.8),
  )

  const compensations = []
  approvedCandidates.forEach((order, idx) => {
    const id = `CMP-${String(idx + 1).padStart(4, '0')}`
    const day = Math.min(28, dayOf(order.completed_at) + 1)
    const approvedAt = isoAt(day, 10 * 60 + 30)
    compensations.push({
      id,
      order_id: order.id,
      district_id: 'D-XXT',
      reason: pick(rng, COMP_REASONS),
      responsibility: rng() < 0.85 ? 'cleaner' : 'product',
      amount: approvedAmounts[idx],
      evidence_score: randInt(rng, 70, 100),
      evidence_refs: [order.photos_after[0] || order.photos_before[0] || `mock://ref/${id}`],
      status: 'approved',
      approver_chain: [
        {
          role: 'district_manager',
          user: 'MGR-D-XXT',
          at: approvedAt,
          decision: 'approve',
        },
      ],
      decided_at: approvedAt,
      approved_at: approvedAt,
      appeal_note: null,
      idempotency_key: id,
      version: 1,
    })
  })
  pendingCandidates.forEach((order, idx) => {
    const id = `CMP-${String(approvedCandidates.length + idx + 1).padStart(4, '0')}`
    const day = Math.min(28, dayOf(order.completed_at) + 1)
    compensations.push({
      id,
      order_id: order.id,
      district_id: 'D-XXT',
      reason: pick(rng, COMP_REASONS),
      responsibility: 'undetermined',
      amount: randInt(rng, 10000, 80000),
      evidence_score: randInt(rng, 10, 45),
      evidence_refs: [],
      status: 'pending_approval',
      approver_chain: [],
      decided_at: null,
      approved_at: null,
      appeal_note: '证据不足，待补充材料',
      idempotency_key: id,
      version: 1,
    })
    // 保持确定性：使用 day 仅为生成可解析时间，不写回
    void day
  })

  /* -------------------------- 投诉 -------------------------- */
  const complaintOrderPool = shuffle(rng, [...westEligible, ...qingxiuEligible])
  const complaints = []
  for (let i = 0; i < SEED_SCALE.complaints; i += 1) {
    const id = `CPT-${String(i + 1).padStart(4, '0')}`
    let order
    let compensation = null
    if (i < compensations.length) {
      compensation = compensations[i]
      order = orderById.get(compensation.order_id)
    } else {
      order = complaintOrderPool[i % complaintOrderPool.length]
    }
    const day = Math.min(28, dayOf(order.completed_at) + 1)
    const createdAt = isoAt(day, 11 * 60 + (i % 8) * 5)
    const resolved = i % 3 !== 0
    complaints.push({
      id,
      order_id: order.id,
      customer_id: order.customer_id,
      district_id: order.district_id,
      channel: pick(rng, COMPLAINT_CHANNELS),
      category: compensation ? 'damage' : pick(rng, COMPLAINT_CATEGORIES),
      content: compensation
        ? '客户反馈服务后发现物品表面损伤（脱敏示例）'
        : '客户反馈服务时效或质量未达预期（脱敏示例）',
      status: resolved ? 'closed' : i % 5 === 0 ? 'processing' : 'resolved',
      compensation_id: compensation ? compensation.id : null,
      created_at: createdAt,
      resolved_at: resolved ? isoAt(Math.min(28, day + 1), 16 * 60) : null,
    })
  }

  /* -------------------------- 返工记录 -------------------------- */
  const reworkCosts = allocateCents(
    SEED_TARGETS.xiangtang.reworkCost,
    westReworkOrders.map(() => 0.7 + rng() * 0.6),
  )
  const reworks = westReworkOrders.map((reworkOrder, idx) => ({
    id: `RW-${String(idx + 1).padStart(4, '0')}`,
    order_id: reworkOrder.rework_of_order_id,
    rework_order_id: reworkOrder.id,
    reason: pick(rng, ORDER_REASONS),
    cost: reworkCosts[idx],
    created_at: reworkOrder.completed_at,
  }))

  /* -------------------------- 空跑记录 -------------------------- */
  const idleCandidates = shuffle(rng, westEligible).slice(0, SEED_SCALE.idleRuns)
  const idleCosts = allocateCents(
    SEED_TARGETS.xiangtang.idleRunCost,
    idleCandidates.map(() => 0.8 + rng() * 0.5),
  )
  const idleRuns = idleCandidates.map((order, idx) => ({
    id: `IR-${String(idx + 1).padStart(4, '0')}`,
    order_id: order.id,
    type: idx % 3 === 0 ? 'reschedule' : 'idle',
    cost: idleCosts[idx],
    reason: pick(rng, IDLE_REASONS),
    created_at: order.scheduled_at,
  }))

  /* -------------------------- 客户冗余汇总 -------------------------- */
  const customerById = new Map(customers.map((c) => [c.id, c]))
  for (const order of orders) {
    const customer = customerById.get(order.customer_id)
    if (!customer) continue
    customer.total_orders += 1
    if (!order.is_rework) customer.total_amount += order.amount
    if (!customer.first_order_at || order.completed_at < customer.first_order_at) {
      customer.first_order_at = order.completed_at
    }
    if (!customer.last_order_at || order.completed_at > customer.last_order_at) {
      customer.last_order_at = order.completed_at
    }
  }
  for (const complaint of complaints) {
    const customer = customerById.get(complaint.customer_id)
    if (customer) customer.complaint_count += 1
  }
  for (const comp of compensations) {
    if (comp.status !== 'approved') continue
    const order = orderById.get(comp.order_id)
    const customer = order ? customerById.get(order.customer_id) : null
    if (customer) customer.compensation_amount += comp.amount
  }
  customers.forEach((customer, idx) => {
    if (idx % 97 === 0) customer.status = 'churned'
    else if (customer.complaint_count >= 2 || customer.compensation_amount > 0) {
      customer.status = 'churn_risk'
    }
    const tags = []
    if (customer.total_amount >= 100000) tags.push('高价值')
    if (customer.complaint_count > 0) tags.push('风险观察')
    if (customer.compensation_amount > 0) tags.push('赔付关注')
    customer.tags = tags
  })

  /* -------------------------- 结算汇总（按阿姨/账期） -------------------------- */
  // 说明：docs 的 settlement_line 为逐单粒度；骨架阶段使用“阿姨×账期”汇总行，
  // 以控制种子体积，后续 M3 可基于工单明细实时重算逐单提成。
  const settlements = cleaners.map((cleaner, idx) => {
    const cleanerOrders = orders.filter(
      (o) =>
        o.cleaner_id === cleaner.id &&
        (o.status === 'completed' || o.status === 'closed'),
    )
    const minutes = cleanerOrders.reduce(
      (sum, o) => sum + Math.min(480, minutesBetween(o.checkin_at, o.completed_at)),
      0,
    )
    const revenue = cleanerOrders
      .filter((o) => !o.is_rework)
      .reduce((sum, o) => sum + o.amount, 0)
    const hourlyPay = roundCents((minutes / 60) * cleaner.hourly_rate)
    const orderPay = roundCents(revenue * cleaner.base_rate)
    const qualityPay = 0
    return {
      id: `STL-${String(idx + 1).padStart(4, '0')}`,
      period: SEED_PERIOD,
      cleaner_id: cleaner.id,
      district_id: cleaner.district_id,
      order_id: null,
      order_count: cleanerOrders.length,
      minutes,
      base_pay: hourlyPay,
      order_pay: orderPay,
      quality_pay: qualityPay,
      total: hourlyPay + orderPay + qualityPay,
      status: 'draft',
    }
  })

  /* -------------------------- 14 个月度汇总 -------------------------- */
  const periods = monthSequence('2025-09', 14)
  const monthlySummary = []
  let monthlySeq = 0
  for (const period of periods) {
    for (const district of districts) {
      monthlySeq += 1
      let revenue
      let directCost
      let compensation
      let reworkCost
      let idleRunCost
      let fixedCost
      let netProfit

      if (district.status === 'config_only') {
        revenue = 0
        directCost = 0
        compensation = 0
        reworkCost = 0
        idleRunCost = 0
        fixedCost = 0
        netProfit = 0
      } else if (period === SEED_PERIOD) {
        const target =
          district.id === 'D-XXT' ? SEED_TARGETS.xiangtang : SEED_TARGETS.qingxiu
        revenue = target.revenue
        directCost = target.directCost
        compensation = target.compensation
        reworkCost = target.reworkCost
        idleRunCost = target.idleRunCost
        fixedCost = target.fixedCost
        netProfit = target.netProfit
      } else {
        const target =
          district.id === 'D-XXT' ? SEED_TARGETS.xiangtang : SEED_TARGETS.qingxiu
        const seasonal = 0.82 + rng() * 0.26
        revenue = Math.round(target.revenue * seasonal)
        directCost = Math.round(revenue * 0.78)
        compensation = Math.round(target.compensation * (0.6 + rng() * 0.9))
        reworkCost = Math.round(target.reworkCost * (0.6 + rng() * 0.9))
        idleRunCost = Math.round(target.idleRunCost * (0.6 + rng() * 0.9))
        fixedCost = target.fixedCost
        netProfit =
          revenue - directCost - compensation - reworkCost - idleRunCost - fixedCost
      }

      monthlySummary.push({
        id: `MS-${String(monthlySeq).padStart(4, '0')}`,
        district_id: district.id,
        period,
        revenue,
        direct_cost: directCost,
        compensation,
        rework_cost: reworkCost,
        idle_run_cost: idleRunCost,
        fixed_cost: fixedCost,
        net_profit: netProfit,
      })
    }
  }

  /* -------------------------- 账期期初 -------------------------- */
  const periodOpening = []
  ;['2026-08', '2026-09', '2026-10'].forEach((period, idx) => {
    periodOpening.push({
      id: `PO-${String(idx * 2 + 1).padStart(4, '0')}`,
      district_id: 'D-XXT',
      period,
      opening_balance: -1_200_000 - idx * 280_000,
    })
    periodOpening.push({
      id: `PO-${String(idx * 2 + 2).padStart(4, '0')}`,
      district_id: 'D-QX',
      period,
      opening_balance: 1_800_000 + idx * 320_000,
    })
  })

  /* -------------------------- 配置与元信息 -------------------------- */
  const config = {
    period: SEED_PERIOD,
    periods,
    currency: 'CNY',
    directCostRateDefault: 0.78,
    qualityWeights: { onTime: 0.2, complaint: 0.5, rework: 0.3 },
    commissionDefaults: { hourlyRate: 2500, baseRate: 0.15 },
    thresholds: {
      compensationCap: 300000,
      secondaryApproval: 30000,
      financeApproval: 50000,
      reworkPayRatio: 0.5,
    },
  }

  return {
    districts,
    cleaners,
    customers,
    orders,
    compensations,
    complaints,
    reworks,
    idleRuns,
    settlements,
    monthlySummary,
    periodOpening,
    config,
    meta: {
      seedId: SEED_ID,
      seedLoaded: true,
      period: SEED_PERIOD,
      periods,
      generatedAt: '2026-11-01T00:00:00+08:00',
      source: 'deterministic-seed',
      scale: { ...SEED_SCALE },
      targets: SEED_TARGETS,
      disclaimer:
        '全部数据为教学虚构，不含真实客户信息、账号或凭据；金额单位为分。',
    },
  }
}

export default buildSeed
