import { describe, expect, it } from 'vitest'
import { distanceMeters, isValidCoordinate } from '../geo.js'

describe('geo（定位距离）', () => {
  it('同一点距离为 0', () => {
    expect(distanceMeters({ lat: 22.8386, lng: 108.2861 }, { lat: 22.8386, lng: 108.2861 })).toBe(0)
  })

  it('纬度 1 度约 111 公里', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_500)
  })

  it('小距离可用于 300 米围栏判断', () => {
    const base = { lat: 22.8386, lng: 108.2861 }
    const near = { lat: 22.8386 + 0.001, lng: 108.2861 } // 约 111 米
    const far = { lat: 22.8386 + 0.01, lng: 108.2861 } // 约 1.1 公里
    expect(distanceMeters(base, near)).toBeGreaterThan(100)
    expect(distanceMeters(base, near)).toBeLessThan(130)
    expect(distanceMeters(base, far)).toBeGreaterThan(1000)
  })

  it('距离对称', () => {
    const a = { lat: 22.8167, lng: 108.3667 }
    const b = { lat: 22.8386, lng: 108.2861 }
    expect(distanceMeters(a, b)).toBe(distanceMeters(b, a))
  })

  it('非法坐标返回 null', () => {
    expect(distanceMeters(null, { lat: 1, lng: 1 })).toBeNull()
    expect(distanceMeters({ lat: Number.NaN, lng: 1 }, { lat: 1, lng: 1 })).toBeNull()
    expect(distanceMeters({ lat: 100, lng: 1 }, { lat: 1, lng: 1 })).toBeNull()
  })

  it('isValidCoordinate 校验范围', () => {
    expect(isValidCoordinate({ lat: 22.8, lng: 108.3 })).toBe(true)
    expect(isValidCoordinate({ lat: '22.8', lng: 108.3 })).toBe(false)
    expect(isValidCoordinate({ lat: 91, lng: 0 })).toBe(false)
    expect(isValidCoordinate({ lat: 0, lng: 181 })).toBe(false)
    expect(isValidCoordinate(undefined)).toBe(false)
  })
})
