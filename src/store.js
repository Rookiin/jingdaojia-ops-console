/**
 * 自写轻 store（无 Zustand）。
 *
 * - createStore(initialState)：getState / setState / subscribe / reset
 * - useStore(selector)：内部 useSyncExternalStore，只订阅选中的切片
 * - localStorage 持久化：key = njdao:v1，载荷 { version: 1, state }
 * - version 不匹配走 migrate；解析失败清空并由 loader 重新注入种子
 *
 * 注意：selector 必须返回原始值或稳定引用，避免每次 getSnapshot 新建对象。
 */
import { useSyncExternalStore } from 'react'

export const STORAGE_KEY = 'njdao:v1'
export const STORAGE_VERSION = 1

/**
 * 空状态切片（docs §4.3）。
 * @returns {Object}
 */
export function createEmptyState() {
  return {
    session: null,
    districts: [],
    cleaners: [],
    customers: [],
    orders: [],
    compensations: [],
    complaints: [],
    reworks: [],
    idleRuns: [],
    settlements: [],
    monthlySummary: [],
    periodOpening: [],
    config: {},
    meta: {
      seedId: null,
      seedLoaded: false,
      period: '2026-10',
      storageError: null,
    },
  }
}

function canUseStorage() {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined' &&
      window.localStorage !== null
    )
  } catch {
    return false
  }
}

/**
 * 迁移持久化载荷。当前仅 v1；未来版本在此逐级升级。
 * 返回 null 表示不可恢复，调用方应清空并重新注入种子。
 *
 * @param {{version?: number, state?: Object}} payload
 * @returns {Object|null}
 */
export function migrate(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (!payload.state || typeof payload.state !== 'object') return null

  if (payload.version === STORAGE_VERSION) return payload.state

  if (typeof payload.version === 'number' && payload.version < STORAGE_VERSION) {
    // 示例迁移：v0 → v1，补齐 meta 字段
    const state = payload.state
    return {
      ...state,
      meta: {
        seedId: null,
        seedLoaded: false,
        period: '2026-10',
        ...(state.meta || {}),
        migratedFrom: payload.version,
      },
    }
  }
  return null
}

function persistState(state) {
  if (!canUseStorage()) return { ok: false, reason: 'unavailable' }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, state }),
    )
    return { ok: true }
  } catch {
    // QuotaExceeded / 隐私模式等：不阻断 UI，仅表示未持久化
    return { ok: false, reason: 'write_failed' }
  }
}

/**
 * 读取本地持久化状态。解析/版本失败时清空 key。
 * @returns {{state: Object|null, error: string|null}}
 */
export function loadPersistedState() {
  if (!canUseStorage()) return { state: null, error: null }
  let raw
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return { state: null, error: '无法读取本地存储，已在内存中运行' }
  }
  if (!raw) return { state: null, error: null }

  try {
    const parsed = JSON.parse(raw)
    const migrated = migrate(parsed)
    if (!migrated) {
      window.localStorage.removeItem(STORAGE_KEY)
      return { state: null, error: '本地数据版本不兼容，已重置为种子数据' }
    }
    return { state: migrated, error: null }
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return { state: null, error: '本地数据解析失败，已重置为种子数据' }
  }
}

/**
 * 清除持久化（演示重置用）。
 */
export function clearPersistence() {
  if (!canUseStorage()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 创建轻 store。
 * @param {Object} initialState
 * @returns {{getState:Function,setState:Function,subscribe:Function,reset:Function,hydrate:Function,replace:Function}}
 */
export function createStore(initialState) {
  if (!initialState || typeof initialState !== 'object') {
    throw new Error('createStore(initialState) 需要一个对象作为初始状态')
  }

  let state = initialState
  const listeners = new Set()

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 单个订阅者异常不应阻断其它订阅者
      }
    }
  }

  const getState = () => state

  const setState = (patch) => {
    const next = typeof patch === 'function' ? patch(state) : patch
    if (!next || typeof next !== 'object') return
    state = { ...state, ...next }
    persistState(state)
    notify()
  }

  const subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const reset = () => {
    state = initialState
    persistState(state)
    notify()
  }

  /** 合并持久化状态（不额外写回时为 false）。 */
  const hydrate = (next, options = {}) => {
    if (!next || typeof next !== 'object') return
    state = { ...state, ...next }
    if (options.persist !== false) persistState(state)
    notify()
  }

  /** 整体替换（迁移/清空重载用）。 */
  const replace = (next) => {
    state = next
    persistState(state)
    notify()
  }

  return { getState, setState, subscribe, reset, hydrate, replace }
}

/**
 * 应用单例 store。模块加载时尝试从 localStorage 恢复；
 * 若无数据或解析失败则由 data/loader.js 幂等注入种子。
 */
export const store = createStore(createEmptyState())

const persisted = loadPersistedState()
if (persisted.state) {
  store.hydrate(
    {
      ...persisted.state,
      meta: {
        ...store.getState().meta,
        ...(persisted.state.meta || {}),
        storageError: persisted.error || null,
      },
    },
    { persist: false },
  )
} else if (persisted.error) {
  store.hydrate(
    {
      meta: { ...store.getState().meta, storageError: persisted.error },
    },
    { persist: false },
  )
}

/**
 * 订阅 store 切片。
 * selector 必须返回原始值或稳定引用，例如 s => s.orders。
 *
 * @param {(state:Object)=>any} selector
 * @returns {any}
 */
export function useStore(selector = (s) => s) {
  const getSnapshot = () => selector(store.getState())
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export default store
