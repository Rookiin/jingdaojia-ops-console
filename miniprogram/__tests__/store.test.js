/**
 * 小程序逻辑层测试（Node 环境，桩掉 wx API）。
 * 不加载页面文件（页面依赖 Page/getApp），只验证 store + 共享内核链路。
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

let sharedMemory = new Map()

function installWxStub({ failRead = false, keepMemory = false } = {}) {
  if (!keepMemory) sharedMemory = new Map()
  const memory = sharedMemory
  globalThis.wx = {
    getStorageSync(key) {
      if (failRead) throw { errMsg: 'getStorageSync:fail mock' }
      return memory.has(key) ? memory.get(key) : ''
    },
    setStorageSync(key, value) {
      memory.set(key, value)
    },
    removeStorageSync(key) {
      memory.delete(key)
    },
    getStorageInfoSync() {
      return { currentSize: 3, limitSize: 10240 }
    },
    __memory: memory,
  }
  return globalThis.wx
}

async function freshStore(options) {
  installWxStub(options)
  vi.resetModules()
  const mod = await import('../store.js')
  return mod.createStore()
}

afterEach(() => {
  vi.resetModules()
})

describe('小程序 store（种子注入与状态流转）', () => {
  let store
  let cleaner
  let assigned
  let checkedIn

  beforeEach(async () => {
    store = await freshStore()
    const state = store.getState()
    cleaner = state.cleaners[0]
    const tasks = store.getTasksForCleaner(cleaner.id)
    assigned = tasks.find((task) => task.status === 'assigned')
    checkedIn = tasks.find((task) => task.status === 'checked_in')
  })

  it('首次启动注入 6 张演示任务，未登录时无当前阿姨', () => {
    const state = store.getState()
    expect(state.tasks).toHaveLength(6)
    expect(state.cleaners).toHaveLength(3)
    expect(state.currentCleanerId).toBeNull()
    expect(state.radiusM).toBe(300)
  })

  it('登录后按阿姨取任务，按预约时间升序', () => {
    expect(assigned).toBeTruthy()
    expect(checkedIn).toBeTruthy()
    store.setCurrentCleaner(cleaner.id)
    const tasks = store.getTasksForCleaner(cleaner.id)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].scheduled_at <= tasks[1].scheduled_at).toBe(true)
    expect(store.countByStatus(cleaner.id)).toEqual({
      assigned: 1,
      checked_in: 1,
      completed: 0,
    })
    expect(store.getCleaner(cleaner.id).name).toBe(cleaner.name)
  })

  it('300 米内打卡成功并落库，重复打卡幂等', () => {
    const customer = store.getCustomer(assigned.customer_id)
    const payload = {
      at: '2026-11-02T09:05:00+08:00',
      location: { lat: customer.lat, lng: customer.lng, accuracy: 18 },
      photosBefore: ['wxfile://before-a.jpg'],
    }

    const first = store.checkIn(assigned.id, payload)
    expect(first.ok).toBe(true)
    expect(first.order.status).toBe('checked_in')
    expect(store.getTask(assigned.id).status).toBe('checked_in')
    expect(wx.__memory.size).toBeGreaterThan(0)

    const second = store.checkIn(assigned.id, payload)
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(store.getTask(assigned.id).field_events).toHaveLength(1)
  })

  it('超出 300 米打卡被拒，状态不变', () => {
    const customer = store.getCustomer(assigned.customer_id)
    const result = store.checkIn(assigned.id, {
      at: '2026-11-02T09:05:00+08:00',
      location: { lat: customer.lat + 0.02, lng: customer.lng, accuracy: 20 },
      photosBefore: ['wxfile://before-a.jpg'],
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('OUT_OF_RANGE')
    expect(store.getTask(assigned.id).status).toBe('assigned')
  })

  it('缺照片 / 缺定位分别给出可读提示', () => {
    const customer = store.getCustomer(assigned.customer_id)
    expect(
      store.checkIn(assigned.id, {
        at: '2026-11-02T09:05:00+08:00',
        location: { lat: customer.lat, lng: customer.lng },
        photosBefore: [],
      }).code,
    ).toBe('MISSING_PHOTO')
    expect(
      store.checkIn(assigned.id, {
        at: '2026-11-02T09:05:00+08:00',
        location: null,
        photosBefore: ['wxfile://before-a.jpg'],
      }).code,
    ).toBe('MISSING_LOCATION')
  })

  it('已打卡任务可完成，无签字标记待补', () => {
    const result = store.complete(checkedIn.id, {
      at: '2026-11-02T11:10:00+08:00',
      photosAfter: ['wxfile://after-a.jpg'],
    })
    expect(result.ok).toBe(true)
    expect(result.order.status).toBe('completed')
    expect(result.order.signature_pending).toBe(true)
    const saved = store.getTask(checkedIn.id)
    expect(saved.completed_at).toBe('2026-11-02T11:10:00+08:00')
    expect(saved.photos_after).toEqual(['wxfile://after-a.jpg'])
    expect(store.countByStatus(checkedIn.cleaner_id).completed).toBe(1)
  })

  it('未打卡不能完成；重复完成幂等', () => {
    expect(
      store.complete(assigned.id, {
        at: '2026-11-02T11:10:00+08:00',
        photosAfter: ['wxfile://after-a.jpg'],
      }).code,
    ).toBe('INVALID_STATUS')

    const first = store.complete(checkedIn.id, {
      at: '2026-11-02T11:10:00+08:00',
      photosAfter: ['wxfile://after-a.jpg'],
    })
    const second = store.complete(checkedIn.id, {
      at: '2026-11-02T12:00:00+08:00',
      photosAfter: ['wxfile://after-b.jpg'],
    })
    expect(first.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(store.getTask(checkedIn.id).photos_after).toEqual(['wxfile://after-a.jpg'])
  })

  it('本地已保存的状态在再次启动时被读取', async () => {
    const customer = store.getCustomer(assigned.customer_id)
    store.checkIn(assigned.id, {
      at: '2026-11-02T09:05:00+08:00',
      location: { lat: customer.lat, lng: customer.lng },
      photosBefore: ['wxfile://before-a.jpg'],
    })

    const reloaded = await freshStore({ keepMemory: true })
    expect(reloaded.getTask(assigned.id).status).toBe('checked_in')
  })

  it('重置后回到演示基线', () => {
    const customer = store.getCustomer(assigned.customer_id)
    store.checkIn(assigned.id, {
      at: '2026-11-02T09:05:00+08:00',
      location: { lat: customer.lat, lng: customer.lng },
      photosBefore: ['wxfile://before-a.jpg'],
    })
    const state = store.reset()
    expect(state.tasks.filter((task) => task.status === 'assigned')).toHaveLength(3)
    expect(state.currentCleanerId).toBeNull()
  })

  it('本地读取失败时给出可读错误而不是崩溃', async () => {
    const broken = await freshStore({ failRead: true })
    expect(broken.getStorageError()).toContain('读取本地数据失败')
    expect(broken.getState().tasks).toHaveLength(6)
  })

  it('找不到工单时返回 NOT_FOUND', () => {
    const result = store.checkIn('O-NOT-EXIST', {
      at: '2026-11-02T09:05:00+08:00',
      location: { lat: 22.8, lng: 108.3 },
      photosBefore: ['wxfile://before-a.jpg'],
    })
    expect(result.code).toBe('NOT_FOUND')
  })
})
