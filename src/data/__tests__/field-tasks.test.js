import { describe, expect, it } from 'vitest'
import {
  FIELD_TASK_STATUSES,
  buildFieldTasks,
} from '../field-tasks.js'
import { SEED, SEED_SCALE, SEED_TARGETS } from '../../domain/__tests__/fixtures.js'
import { selectDistrictRaw } from '../../store/selectors.js'

const BUNDLE = buildFieldTasks(SEED)

describe('field-tasks（阿姨端数据包）', () => {
  it('只包含 6 张在途任务（3 张 assigned + 3 张 checked_in）', () => {
    expect(BUNDLE.tasks).toHaveLength(SEED_SCALE.fieldTasks)
    expect(BUNDLE.tasks).toHaveLength(6)
    const counts = BUNDLE.tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1
      return acc
    }, {})
    expect(counts).toEqual({ assigned: 3, checked_in: 3 })
    for (const task of BUNDLE.tasks) {
      expect(FIELD_TASK_STATUSES).toContain(task.status)
      expect(task.completed_at).toBeNull()
    }
  })

  it('3 位阿姨每人 2 张任务', () => {
    expect(BUNDLE.cleaners).toHaveLength(3)
    const perCleaner = BUNDLE.tasks.reduce((acc, task) => {
      acc[task.cleaner_id] = (acc[task.cleaner_id] || 0) + 1
      return acc
    }, {})
    expect(Object.keys(perCleaner)).toHaveLength(3)
    expect(Object.values(perCleaner)).toEqual([2, 2, 2])
  })

  it('客户快照带合法虚构坐标与脱敏手机', () => {
    expect(BUNDLE.customers).toHaveLength(6)
    for (const customer of BUNDLE.customers) {
      expect(Number.isFinite(customer.lat)).toBe(true)
      expect(Number.isFinite(customer.lng)).toBe(true)
      expect(customer.lat).toBeGreaterThan(22)
      expect(customer.lat).toBeLessThan(23)
      expect(customer.address).toContain('（虚构）')
      expect(customer.phone_masked).toMatch(/\d{4}$/)
    }
  })

  it('checked_in 任务自带打卡事件，assigned 任务为空', () => {
    for (const task of BUNDLE.tasks) {
      if (task.status === 'checked_in') {
        expect(task.checkin_at).toBeTruthy()
        expect(task.field_events).toHaveLength(1)
        expect(task.field_events[0].type).toBe('checkin')
        expect(task.photos_before.length).toBeGreaterThan(0)
      } else {
        expect(task.checkin_at).toBeNull()
        expect(task.field_events).toEqual([])
      }
    }
  })

  it('在途任务不计营收：两片区营收仍等于验收目标', () => {
    const west = selectDistrictRaw(SEED, 'D-XXT', '2026-10')
    const east = selectDistrictRaw(SEED, 'D-QX', '2026-10')
    expect(west.revenue).toBe(SEED_TARGETS.xiangtang.revenue)
    expect(east.revenue).toBe(SEED_TARGETS.qingxiu.revenue)
  })

  it('数据包体积远小于微信单 key 1MB 限制', () => {
    const size = Buffer.byteLength(JSON.stringify(BUNDLE), 'utf8')
    expect(size).toBeLessThan(100 * 1024)
  })

  it('演示日期与围栏半径随包下发', () => {
    expect(BUNDLE.demoDate).toBe('2026-11-02')
    expect(BUNDLE.radiusM).toBe(300)
    expect(BUNDLE.seedId).toBe(SEED.meta.seedId)
  })
})
