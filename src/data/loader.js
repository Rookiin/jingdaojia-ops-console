/**
 * 种子加载器：解析 + 校验 + 幂等注入 store。
 *
 * 幂等保护（StrictMode 双执行 / 刷新）：
 * 1) 模块级 seedInjected 一次性标志；
 * 2) 持久化 meta.seedId + meta.seedLoaded；
 * 3) 各集合按 id upsert。
 */
import { store, clearPersistence } from '../store.js'
import { buildSeed, SEED_ID, SEED_PERIOD } from './generate.js'
import { validateSeed } from './validate.js'

const COLLECTIONS = [
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

let seedInjected = false

function hasSeedData(state) {
  return (
    Array.isArray(state?.districts) &&
    state.districts.length > 0 &&
    Array.isArray(state?.orders) &&
    state.orders.length > 0
  )
}

function upsertById(existing, incoming) {
  const current = Array.isArray(existing) ? existing : []
  const source = Array.isArray(incoming) ? incoming : []
  if (current.length === 0) return source
  const ids = new Set(current.map((item) => item && item.id))
  const additions = source.filter((item) => item && !ids.has(item.id))
  if (additions.length === 0) return current
  return [...current, ...additions]
}

/**
 * 幂等注入种子。
 * @param {Object} seed buildSeed() 的结果
 * @returns {{injected:boolean, reason:string, seedId:string|null, errors:string[]}}
 */
export function injectSeed(seed) {
  if (!seed || !seed.meta) {
    return { injected: false, reason: 'empty', seedId: null, errors: ['种子为空'] }
  }

  const state = store.getState()
  const incomingSeedId = seed.meta.seedId

  if (
    seedInjected &&
    state.meta?.seedLoaded &&
    state.meta?.seedId === incomingSeedId &&
    hasSeedData(state)
  ) {
    return { injected: false, reason: 'already_injected', seedId: incomingSeedId, errors: [] }
  }

  if (
    state.meta?.seedLoaded &&
    state.meta?.seedId === incomingSeedId &&
    hasSeedData(state)
  ) {
    seedInjected = true
    return { injected: false, reason: 'persisted', seedId: incomingSeedId, errors: [] }
  }

  const next = {}
  for (const key of COLLECTIONS) {
    next[key] = upsertById(state[key], seed[key])
  }

  next.config = { ...(seed.config || {}), ...(state.config || {}) }
  next.meta = {
    ...state.meta,
    ...seed.meta,
    seedId: incomingSeedId,
    seedLoaded: true,
    storageError: state.meta?.storageError ?? null,
  }

  store.setState(next)
  seedInjected = true
  return { injected: true, reason: 'seeded', seedId: incomingSeedId, errors: [] }
}

/**
 * 应用启动入口：首次加载注入种子；已有持久化数据则跳过。
 * @param {{force?: boolean}} [options]
 * @returns {{injected:boolean, reason:string, seedId:string|null, errors:string[]}}
 */
export function loadSeed(options = {}) {
  const state = store.getState()

  if (
    options.force !== true &&
    state.meta?.seedLoaded &&
    state.meta?.seedId === SEED_ID &&
    hasSeedData(state)
  ) {
    seedInjected = true
    return { injected: false, reason: 'persisted', seedId: SEED_ID, errors: [] }
  }

  if (options.force === true) {
    seedInjected = false
    store.reset()
  }

  const seed = buildSeed()
  const { ok, errors } = validateSeed(seed)

  if (!ok) {
    store.setState({
      meta: {
        ...store.getState().meta,
        validationErrors: errors.slice(0, 100),
        storageError: `种子校验失败（${errors.length} 项），请检查 data/generate.js`,
      },
    })
    return { injected: false, reason: 'invalid', seedId: SEED_ID, errors }
  }

  return injectSeed(seed)
}

/**
 * 演示控制：清空持久化并重新注入基线。
 * @returns {{injected:boolean, reason:string, seedId:string|null, errors:string[]}}
 */
export function resetSeed() {
  clearPersistence()
  return loadSeed({ force: true })
}

/**
 * 当前种子状态。
 * @returns {{seedId:string|null, seedLoaded:boolean, period:string, storageError:string|null}}
 */
export function getSeedStatus() {
  const meta = store.getState().meta || {}
  return {
    seedId: meta.seedId || null,
    seedLoaded: Boolean(meta.seedLoaded),
    period: meta.period || SEED_PERIOD,
    storageError: meta.storageError || null,
  }
}

export default loadSeed
