/**
 * 阿姨端本地 store（无框架依赖）。
 *
 * 首次启动从 data/seed.js 注入演示数据，之后整份状态写入 wx storage。
 * 业务规则全部来自 core/field-actions.js（与 Web 端同一份源码）。
 */
import { checkInOrder, completeOrder } from './core/field-actions.js'
import seed from './data/seed.js'
import {
  clearStoredState,
  readStoredState,
  writeStoredState,
  getStorageError,
} from './services/storage.js'

export const STORAGE_KEY = 'njdao:mp:v1'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createInitialState() {
  return {
    seedId: seed.seedId,
    demoDate: seed.demoDate,
    radiusM: seed.radiusM,
    currentCleanerId: null,
    cleaners: clone(seed.cleaners),
    customers: clone(seed.customers),
    tasks: clone(seed.tasks),
    updatedAt: null,
  }
}

export function createStore() {
  const persisted = readStoredState()
  let state = persisted && Array.isArray(persisted.tasks) ? persisted : createInitialState()
  const listeners = new Set()

  function notify() {
    listeners.forEach((listener) => listener(state))
  }

  function commit(next) {
    state = { ...state, ...next }
    writeStoredState(state)
    notify()
  }

  return {
    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getStorageError,

    setCurrentCleaner(cleanerId) {
      commit({ currentCleanerId: cleanerId })
    },

    clearCurrentCleaner() {
      commit({ currentCleanerId: null })
    },

    getCleaner(cleanerId) {
      return state.cleaners.find((cleaner) => cleaner.id === cleanerId) || null
    },

    getCustomer(customerId) {
      return state.customers.find((customer) => customer.id === customerId) || null
    },

    getTask(orderId) {
      return state.tasks.find((task) => task.id === orderId) || null
    },

    getTasksForCleaner(cleanerId) {
      return state.tasks
        .filter((task) => task.cleaner_id === cleanerId)
        .slice()
        .sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1))
    },

    countByStatus(cleanerId) {
      const counts = { assigned: 0, checked_in: 0, completed: 0 }
      for (const task of state.tasks) {
        if (task.cleaner_id !== cleanerId) continue
        if (counts[task.status] !== undefined) counts[task.status] += 1
      }
      return counts
    },

    /**
     * 到店打卡：调用共享内核，成功则整单落库。
     */
    checkIn(orderId, payload) {
      const task = this.getTask(orderId)
      if (!task) return { ok: false, code: 'NOT_FOUND', message: '找不到这张单，请刷新后重试' }
      const customer = this.getCustomer(task.customer_id)
      const result = checkInOrder({
        order: task,
        customer,
        at: payload.at,
        location: payload.location,
        photosBefore: payload.photosBefore,
        radiusM: state.radiusM,
        operator: task.cleaner_id,
      })
      if (!result.ok) return result
      if (result.idempotent) return result
      const tasks = state.tasks.map((item) => (item.id === orderId ? result.order : item))
      commit({ tasks, updatedAt: result.order.updated_at })
      return result
    },

    /**
     * 完成服务：调用共享内核，成功则整单落库。
     */
    complete(orderId, payload) {
      const task = this.getTask(orderId)
      if (!task) return { ok: false, code: 'NOT_FOUND', message: '找不到这张单，请刷新后重试' }
      const result = completeOrder({
        order: task,
        at: payload.at,
        photosAfter: payload.photosAfter,
        signature: payload.signature,
        operator: task.cleaner_id,
      })
      if (!result.ok) return result
      if (result.idempotent) return result
      const tasks = state.tasks.map((item) => (item.id === orderId ? result.order : item))
      commit({ tasks, updatedAt: result.order.updated_at })
      return result
    },

    reset() {
      clearStoredState()
      state = createInitialState()
      notify()
      return state
    },
  }
}
