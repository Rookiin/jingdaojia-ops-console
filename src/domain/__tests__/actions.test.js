import { beforeEach, describe, expect, it } from 'vitest'
import { store } from '../../store.js'
import { loadSeed } from '../../data/loader.js'
import {
  addCompensation,
  addComplaint,
  addIdleRun,
  addRework,
  approveCompensation,
  createOrder,
  resetDemoData,
  setActivePeriod,
  setQualityOverride,
  transitionOrder,
} from '../../store/actions.js'
import { aggregateLeakage } from '../../domain/leakage.js'
import { PERIOD } from './fixtures.js'

const AT = '2026-10-20T09:00:00+08:00'

beforeEach(() => {
  loadSeed({ force: true })
})

function seedRefs() {
  const state = store.getState()
  const order = state.orders[0]
  return {
    district_id: order.district_id,
    customer_id: order.customer_id,
    cleaner_id: order.cleaner_id,
    orderId: order.id,
  }
}

function newOrderInput(overrides = {}) {
  return {
    id: 'O-TEST-NEW',
    order_no: 'NO-TEST-NEW',
    amount: 12_000,
    ...seedRefs(),
    ...overrides,
  }
}

describe('actions（写入口：幂等 / 状态机 / 审批）', () => {
  it('createOrder 成功后按幂等键去重', () => {
    const before = store.getState().orders.length
    const first = createOrder(newOrderInput())
    expect(first.ok).toBe(true)
    expect(first.data.status).toBe('created')
    expect(first.data.idempotency_key).toBe('create:O-TEST-NEW')
    expect(store.getState().orders.length).toBe(before + 1)

    const again = createOrder(newOrderInput())
    expect(again.ok).toBe(true)
    expect(again.duplicate).toBe(true)
    expect(store.getState().orders.length).toBe(before + 1)
  })

  it('createOrder 校验金额 / 关联实体', () => {
    expect(createOrder(newOrderInput({ amount: 0 })).code).toBe('INVALID_INPUT')
    expect(createOrder(newOrderInput({ district_id: 'D-NONE' })).code).toBe('NOT_FOUND')
    expect(createOrder(newOrderInput({ cleaner_id: 'C-NONE' })).code).toBe('NOT_FOUND')
  })

  it('工单状态机：不可跳步、完成需签字与时间', () => {
    const { orderId } = seedRefs()
    const created = createOrder(newOrderInput({ signature: 'mock://sig' }))
    expect(created.ok).toBe(true)
    const id = created.data.id

    expect(transitionOrder(id, 'completed').code).toBe('INVALID_TRANSITION')

    expect(transitionOrder(id, 'assigned', { at: AT }).ok).toBe(true)
    expect(transitionOrder(id, 'checked_in', { at: AT }).ok).toBe(true)
    expect(store.getState().orders.find((o) => o.id === id).checkin_at).toBe(AT)
    expect(transitionOrder(id, 'completed').code).toBe('MISSING_TIME')

    const done = transitionOrder(id, 'completed', { at: '2026-10-20T11:00:00+08:00' })
    expect(done.ok).toBe(true)
    expect(done.data.completed_at).toBe('2026-10-20T11:00:00+08:00')

    const same = transitionOrder(id, 'completed')
    expect(same.idempotent).toBe(true)
    expect(orderId).toBeTruthy()
  })

  it('无签字完成被拒绝；显式 allowMissingSignature 放行', () => {
    const created = createOrder(newOrderInput({ id: 'O-TEST-NOSIG', order_no: 'NO-NOSIG' }))
    const id = created.data.id
    transitionOrder(id, 'assigned', { at: AT })
    transitionOrder(id, 'checked_in', { at: AT })
    expect(transitionOrder(id, 'completed', { at: AT }).code).toBe('MISSING_SIGNATURE')
    expect(
      transitionOrder(id, 'completed', { at: AT, allowMissingSignature: true }).ok,
    ).toBe(true)
  })

  it('取消单记录原因（缺省填“未填写原因”）', () => {
    const created = createOrder(newOrderInput({ id: 'O-TEST-CXL', order_no: 'NO-CXL' }))
    const cancelled = transitionOrder(created.data.id, 'cancelled')
    expect(cancelled.ok).toBe(true)
    expect(cancelled.data.cancel_reason).toBe('未填写原因')
  })

  it('赔付审批：时间必填、>500 元需财务、审批后再审幂等', () => {
    const { orderId } = seedRefs()
    const added = addCompensation({
      id: 'COMP-TEST-1',
      order_id: orderId,
      amount: 20_000,
      reason: 'scratch',
    })
    expect(added.ok).toBe(true)
    expect(added.data.status).toBe('pending_approval')
    expect(added.data.district_id).toBe(store.getState().orders.find((o) => o.id === orderId).district_id)

    const dup = addCompensation({ id: 'COMP-TEST-1', order_id: orderId, amount: 20_000 })
    expect(dup.duplicate).toBe(true)

    expect(approveCompensation('COMP-TEST-1').code).toBe('MISSING_TIME')
    expect(approveCompensation('COMP-TEST-1', { at: AT }).ok).toBe(true)
    const again = approveCompensation('COMP-TEST-1', { at: AT })
    expect(again.idempotent).toBe(true)
    expect(again.data.approver_chain).toHaveLength(1)

    addCompensation({ id: 'COMP-BIG', order_id: orderId, amount: 80_000 })
    expect(approveCompensation('COMP-BIG', { at: AT }).code).toBe('FORBIDDEN')
    expect(
      approveCompensation('COMP-BIG', { at: AT, role: 'finance' }).ok,
    ).toBe(true)
  })

  it('A9：同一赔付重复提交只入账一次', () => {
    const { orderId } = seedRefs()
    const before = aggregateLeakage({
      compensations: store.getState().compensations,
      period: PERIOD,
      approvedOnly: true,
    }).compensation
    expect(before).toBe(1_400_000)

    addCompensation({ id: 'COMP-A9', order_id: orderId, amount: 10_000 })
    addCompensation({ id: 'COMP-A9', order_id: orderId, amount: 10_000 })
    approveCompensation('COMP-A9', { at: AT })
    approveCompensation('COMP-A9', { at: AT })

    const after = aggregateLeakage({
      compensations: store.getState().compensations,
      period: PERIOD,
      approvedOnly: true,
    }).compensation
    expect(after).toBe(1_410_000)
    expect(
      store.getState().compensations.filter((c) => c.id === 'COMP-A9'),
    ).toHaveLength(1)
  })

  it('投诉按 id 去重，并继承工单的客户/片区', () => {
    const { orderId } = seedRefs()
    const first = addComplaint({ id: 'CPL-TEST', order_id: orderId, content: '边角没擦' })
    expect(first.ok).toBe(true)
    expect(first.data.status).toBe('open')
    expect(first.data.channel).toBe('phone')
    const dup = addComplaint({ id: 'CPL-TEST', order_id: orderId })
    expect(dup.duplicate).toBe(true)
    expect(addComplaint({ id: 'CPL-X', order_id: 'O-NONE' }).code).toBe('NOT_FOUND')
  })

  it('返工 / 空跑：校验成本与关联订单，入账只算一次', () => {
    const { orderId } = seedRefs()
    expect(addRework({ id: 'RW-X', order_id: orderId, cost: -1 }).code).toBe('INVALID_INPUT')
    expect(addRework({ id: 'RW-X', order_id: orderId, cost: 1, rework_order_id: 'O-NONE' }).code).toBe('NOT_FOUND')
    expect(addIdleRun({ id: 'ID-X', order_id: 'O-NONE', cost: 1 }).code).toBe('NOT_FOUND')

    addRework({ id: 'RW-TEST', order_id: orderId, cost: 5_000, created_at: AT })
    addRework({ id: 'RW-TEST', order_id: orderId, cost: 5_000, created_at: AT })
    addIdleRun({ id: 'ID-TEST', order_id: orderId, cost: 3_000, created_at: AT })

    const leak = aggregateLeakage({
      reworks: store.getState().reworks,
      idleRuns: store.getState().idleRuns,
      period: PERIOD,
      orderById: new Map(store.getState().orders.map((o) => [o.id, o])),
    })
    expect(leak.reworkCost).toBe(1_300_000 + 5_000)
    expect(leak.idleRunCost).toBe(680_000 + 3_000)
  })

  it('质量系数覆盖截断到 [0.8,1.2]，null 可清除', () => {
    const cleaner = store.getState().cleaners[0]
    const high = setQualityOverride(cleaner.id, 2)
    expect(high.data.quality_coef_override).toBe(1.2)
    const cleared = setQualityOverride(cleaner.id, null)
    expect(cleared.data.quality_coef_override).toBeNull()
    expect(setQualityOverride(cleaner.id, 'x').code).toBe('INVALID_INPUT')
    expect(setQualityOverride('C-NONE', 1).code).toBe('NOT_FOUND')
  })

  it('setActivePeriod 校验 YYYY-MM 并写 meta', () => {
    expect(setActivePeriod('2026-11').ok).toBe(true)
    expect(store.getState().meta.period).toBe('2026-11')
    expect(setActivePeriod('2026-13').code).toBe('INVALID_INPUT')
    expect(setActivePeriod(202611).code).toBe('INVALID_INPUT')
  })

  it('resetDemoData 清空写入并回到基线', () => {
    createOrder(newOrderInput({ id: 'O-TMP', order_no: 'NO-TMP' }))
    expect(store.getState().orders.some((o) => o.id === 'O-TMP')).toBe(true)
    const r = resetDemoData()
    expect(r.ok).toBe(true)
    expect(store.getState().orders.some((o) => o.id === 'O-TMP')).toBe(false)
    expect(store.getState().meta.seedLoaded).toBe(true)
  })
})
