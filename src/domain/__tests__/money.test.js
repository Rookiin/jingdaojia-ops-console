import { describe, expect, it } from 'vitest'
import {
  centsToYuan,
  clamp,
  isFiniteNumber,
  namedError,
  pctOrNull,
  ratioOrNull,
  round2,
  roundCents,
  sumCents,
  yuanToCents,
} from '../money.js'

describe('money（整数分口径）', () => {
  it('元转分四舍五入，避免 0.1+0.2 类浮点误差', () => {
    expect(yuanToCents(76.13)).toBe(7613)
    expect(yuanToCents(0.1 + 0.2)).toBe(30)
    expect(yuanToCents('12.345')).toBe(1235)
  })

  it('分转元仅用于展示', () => {
    expect(centsToYuan(7613)).toBe(76.13)
    expect(centsToYuan('bad')).toBe(0)
  })

  it('roundCents / round2 对非法输入退化为 0', () => {
    expect(roundCents(2.5)).toBe(3)
    expect(roundCents(undefined)).toBe(0)
    expect(round2(0.993666)).toBe(0.99)
    expect(round2('x')).toBe(0)
  })

  it('sumCents 先取整再累加', () => {
    expect(sumCents([1_400_000, 1_300_000, 680_000])).toBe(3_380_000)
    expect(sumCents([0.4, 0.4])).toBe(1)
    expect(sumCents([])).toBe(0)
  })

  it('clamp 截断到闭区间', () => {
    expect(clamp(1.5, 0.8, 1.2)).toBe(1.2)
    expect(clamp(0.1, 0.8, 1.2)).toBe(0.8)
    expect(clamp(1, 0.8, 1.2)).toBe(1)
  })

  it('除零比率返回 null 而不是 NaN/Infinity', () => {
    expect(ratioOrNull(1, 0)).toBeNull()
    expect(ratioOrNull(1, null)).toBeNull()
    expect(ratioOrNull(Number.NaN, 2)).toBeNull()
    expect(ratioOrNull(1, 4)).toBe(0.25)
    expect(pctOrNull(5_720_000, 26_000_000)).toBe(22)
    expect(pctOrNull(1, 0)).toBeNull()
  })

  it('isFiniteNumber 排除数字字符串与 Infinity', () => {
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber('1')).toBe(false)
    expect(isFiniteNumber(Infinity)).toBe(false)
    expect(isFiniteNumber(null)).toBe(false)
  })

  it('namedError 携带可捕获的 code', () => {
    const err = namedError('INVALID_INPUT', '坏输入')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('INVALID_INPUT')
    expect(err.name).toBe('INVALID_INPUT')
    expect(err.message).toBe('坏输入')
  })
})
