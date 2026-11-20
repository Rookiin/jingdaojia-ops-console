import { describe, expect, it } from 'vitest'
import {
  assertPeriod,
  comparePeriod,
  isInPeriod,
  monthSequence,
  periodOf,
} from '../period.js'

describe('period（Asia/Shanghai 账期归属，A10）', () => {
  it('A10：10 月最后一小时仍归 10 月，11 月第一小时归 11 月', () => {
    expect(periodOf('2026-10-31T23:30:00+08:00')).toBe('2026-10')
    expect(periodOf('2026-11-01T00:30:00+08:00')).toBe('2026-11')
  })

  it('UTC 时间按上海时区换算（16:30Z = 次日 00:30 +08:00）', () => {
    expect(periodOf('2026-10-31T16:30:00Z')).toBe('2026-11')
    expect(periodOf('2026-10-31T15:30:00Z')).toBe('2026-10')
  })

  it('空值 / 非法时间返回 null', () => {
    expect(periodOf(null)).toBeNull()
    expect(periodOf('')).toBeNull()
    expect(periodOf('not-a-date')).toBeNull()
    expect(periodOf(undefined)).toBeNull()
  })

  it('isInPeriod 与 periodOf 一致', () => {
    expect(isInPeriod('2026-10-01T00:00:00+08:00', '2026-10')).toBe(true)
    expect(isInPeriod('2026-10-01T00:00:00+08:00', '2026-09')).toBe(false)
    expect(isInPeriod(null, '2026-10')).toBe(false)
  })

  it('assertPeriod 拒绝 13 月与单位数月', () => {
    expect(assertPeriod('2026-10')).toBe('2026-10')
    expect(() => assertPeriod('2026-13')).toThrow(/YYYY-MM/)
    expect(() => assertPeriod('2026-1')).toThrow(/YYYY-MM/)
    expect(() => assertPeriod(202610)).toThrow(/YYYY-MM/)
  })

  it('monthSequence 跨年连续生成 14 个账期', () => {
    const seq = monthSequence('2025-09', 14)
    expect(seq).toHaveLength(14)
    expect(seq[0]).toBe('2025-09')
    expect(seq[13]).toBe('2026-10')
    expect(monthSequence('2026-12', 3)).toEqual(['2026-12', '2027-01', '2027-02'])
    expect(monthSequence('2026-12', 0)).toEqual([])
  })

  it('comparePeriod 按字典序比较（YYYY-MM 可比较）', () => {
    expect(comparePeriod('2026-09', '2026-10')).toBe(-1)
    expect(comparePeriod('2026-10', '2026-10')).toBe(0)
    expect(comparePeriod('2027-01', '2026-12')).toBe(1)
    expect(() => comparePeriod('2026/10', '2026-10')).toThrow(/YYYY-MM/)
  })
})
