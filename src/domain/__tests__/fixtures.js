/**
 * 验收夹具（docs §5.1 A1–A10）。
 *
 * 数字来源：
 * - A1/A2/A5：docs §3.4 / §3.5 的试点账，同时由 data/generate.js 的 SEED_TARGETS 固化；
 * - A3：120 分钟 × 25 元/h + 150 元 × 15% + 质量系数 1.05；
 * - A4：60 单，按时 57.6，投诉 1，返工 2。
 */
import { buildSeed, SEED_PERIOD, SEED_SCALE, SEED_TARGETS } from '../../data/generate.js'

/** 验收账期。 */
export const PERIOD = SEED_PERIOD

/** 确定性种子（模块级缓存，多个测试文件共享同一份）。 */
export const SEED = buildSeed()

export { SEED_SCALE, SEED_TARGETS }

/** A1 / A2 的原始输入（分）。 */
export const PNL_INPUTS = {
  xiangtang: {
    districtId: 'D-XXT',
    period: PERIOD,
    revenue: 26_000_000,
    directCost: 20_280_000,
    compensation: 1_400_000,
    reworkCost: 1_300_000,
    idleRunCost: 680_000,
    fixedCost: 5_000_000,
  },
  qingxiu: {
    districtId: 'D-QX',
    period: PERIOD,
    revenue: 52_000_000,
    directCost: 40_560_000,
    compensation: 0,
    reworkCost: 0,
    idleRunCost: 0,
    fixedCost: 9_000_000,
  },
}

/** A5 堵漏情景：赔付 −30%、返工 −25%、空跑 −40%。 */
export const A5_SCENARIO = {
  compensationDrop: 0.3,
  reworkDrop: 0.25,
  idleDrop: 0.4,
}

/** A3 提成算例。 */
export const COMMISSION_CASE = {
  orderId: 'O-TEST-1',
  cleanerId: 'C-TEST-1',
  amount: 15_000,
  checkinAt: '2026-10-15T09:00:00+08:00',
  completedAt: '2026-10-15T11:00:00+08:00',
  hourlyRate: 2_500,
  baseRate: 0.15,
  qualityCoef: 1.05,
  isRework: false,
}

/** A4 质量系数算例（57.6/60 = 0.96 按时）。 */
export const QUALITY_CASE = {
  orders: 60,
  onTimeOrders: 57.6,
  complaintCount: 1,
  reworkCount: 2,
}

/** A6 全证据工单（评分 100）。 */
export function fullEvidenceOrder() {
  return {
    id: 'O-EVIDENCE-FULL',
    checkinAt: '2026-10-01T09:00:00+08:00',
    completedAt: '2026-10-01T11:00:00+08:00',
    photosBefore: ['mock://before/O-EVIDENCE-FULL'],
    photosAfter: ['mock://after/O-EVIDENCE-FULL'],
    signature: 'mock://signature/O-EVIDENCE-FULL',
  }
}

/** A7 无证据工单。 */
export function emptyEvidenceOrder() {
  return {
    id: 'O-EVIDENCE-NONE',
    checkinAt: null,
    completedAt: null,
    photosBefore: [],
    photosAfter: [],
    signature: null,
  }
}
