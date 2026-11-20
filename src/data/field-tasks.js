/**
 * 阿姨端小程序数据包构建（纯函数，无副作用）。
 *
 * 只导出演示所需的子集：3 位阿姨 + 6 张在途任务 + 对应客户快照。
 * 完整种子（1,806 单）不进入小程序，避免超过微信单 key 1MB 限制。
 */
import {
  DISTRICT_CENTERS,
  FIELD_DEMO_DATE,
  SEED_ID,
  SEED_PERIOD,
  buildSeed,
} from './generate.js'
import { FIELD_RADIUS_M } from '../shared/field-actions.js'

export const FIELD_TASK_STATUSES = ['assigned', 'checked_in']

/**
 * 构建阿姨端数据包。
 * @param {Object} [seed] 可选，默认 buildSeed()
 * @returns {{
 *   seedId:string, seedPeriod:string, demoDate:string, radiusM:number,
 *   generatedAt:string|null,
 *   cleaners:Object[], customers:Object[], tasks:Object[]
 * }}
 */
export function buildFieldTasks(seed = buildSeed()) {
  const taskStatuses = new Set(FIELD_TASK_STATUSES)
  const tasks = (seed.orders || []).filter((order) => taskStatuses.has(order.status))

  const cleanerIds = new Set(tasks.map((task) => task.cleaner_id))
  const customerIds = new Set(tasks.map((task) => task.customer_id))

  const cleaners = (seed.cleaners || [])
    .filter((cleaner) => cleanerIds.has(cleaner.id))
    .map((cleaner) => ({
      id: cleaner.id,
      name: cleaner.name,
      phone_masked: cleaner.phone_masked,
      district_id: cleaner.district_id,
    }))

  const customers = (seed.customers || [])
    .filter((customer) => customerIds.has(customer.id))
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone_masked: customer.phone_masked,
      district_id: customer.district_id,
      address: customer.address,
      lat: customer.lat,
      lng: customer.lng,
    }))

  return {
    seedId: seed.meta?.seedId || SEED_ID,
    seedPeriod: SEED_PERIOD,
    demoDate: FIELD_DEMO_DATE,
    radiusM: FIELD_RADIUS_M,
    generatedAt: seed.meta?.generatedAt || null,
    centers: DISTRICT_CENTERS,
    cleaners,
    customers,
    tasks,
  }
}

export default buildFieldTasks
