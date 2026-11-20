import { describe, expect, it } from 'vitest'
import {
  FIELD_RADIUS_M,
  checkInOrder,
  completeOrder,
  fieldEventId,
} from '../field-actions.js'

const CUSTOMER = { lat: 22.8386, lng: 108.2861 }
const AT = '2026-11-02T09:00:00+08:00'
const AT_LATER = '2026-11-02T11:00:00+08:00'

function makeOrder(overrides = {}) {
  return {
    id: 'O-FIELD-1',
    order_no: 'NJ2026110001',
    status: 'assigned',
    cleaner_id: 'C-0001',
    scheduled_at: '2026-11-02T09:00:00+08:00',
    checkin_at: null,
    completed_at: null,
    photos_before: [],
    photos_after: [],
    signature: null,
    field_events: [],
    ...overrides,
  }
}

function checkIn(overrides = {}) {
  return checkInOrder({
    order: makeOrder(),
    customer: CUSTOMER,
    at: AT,
    location: { lat: CUSTOMER.lat, lng: CUSTOMER.lng, accuracy: 15 },
    photosBefore: ['wxfile://before-1.jpg'],
    ...overrides,
  })
}

function checkedInOrder() {
  return checkIn().order
}

describe('checkInOrder（定位打卡）', () => {
  it('300 米内 + 有照片 → checked_in，记录距离与事件', () => {
    const r = checkIn()
    expect(r.ok).toBe(true)
    expect(r.distanceM).toBe(0)
    expect(r.order.status).toBe('checked_in')
    expect(r.order.checkin_at).toBe(AT)
    expect(r.order.checkin_location).toMatchObject({
      lat: CUSTOMER.lat,
      lng: CUSTOMER.lng,
      accuracy: 15,
      distance_m: 0,
      at: AT,
    })
    expect(r.order.photos_before).toEqual(['wxfile://before-1.jpg'])
    expect(r.order.field_events).toHaveLength(1)
    expect(r.order.field_events[0]).toMatchObject({
      id: fieldEventId('O-FIELD-1', 'checkin'),
      type: 'checkin',
      order_id: 'O-FIELD-1',
      distance_m: 0,
    })
    expect(r.order.updated_at).toBe(AT)
  })

  it('重复打卡幂等，不覆盖首次定位', () => {
    const first = checkIn()
    const second = checkInOrder({
      order: first.order,
      customer: CUSTOMER,
      at: AT_LATER,
      location: { lat: 22.9, lng: 108.4, accuracy: 10 },
      photosBefore: ['wxfile://before-2.jpg'],
    })
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.order.checkin_at).toBe(AT)
    expect(second.order.field_events).toHaveLength(1)
  })

  it('非 assigned 状态拒绝', () => {
    expect(checkIn({ order: makeOrder({ status: 'created' }) }).code).toBe('INVALID_STATUS')
    expect(checkIn({ order: makeOrder({ status: 'completed' }) }).code).toBe('INVALID_STATUS')
  })

  it('没有服务前照片拒绝', () => {
    expect(checkIn({ photosBefore: [] }).code).toBe('MISSING_PHOTO')
    expect(checkIn({ photosBefore: ['   '] }).code).toBe('MISSING_PHOTO')
  })

  it('缺少定位或定位非法拒绝', () => {
    expect(checkIn({ location: null }).code).toBe('MISSING_LOCATION')
    expect(checkIn({ location: { lat: Number.NaN, lng: 1 } }).code).toBe('MISSING_LOCATION')
  })

  it('超出 300 米拒绝并返回实际距离', () => {
    const r = checkIn({ location: { lat: CUSTOMER.lat + 0.01, lng: CUSTOMER.lng } })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('OUT_OF_RANGE')
    expect(r.distanceM).toBeGreaterThan(FIELD_RADIUS_M)
    expect(r.message).toContain('米')
  })

  it('边界内（约 111 米）允许打卡', () => {
    const r = checkIn({ location: { lat: CUSTOMER.lat + 0.001, lng: CUSTOMER.lng } })
    expect(r.ok).toBe(true)
    expect(r.distanceM).toBeLessThanOrEqual(FIELD_RADIUS_M)
  })

  it('客户坐标缺失 / 时间非法返回 INVALID_INPUT', () => {
    expect(checkIn({ customer: null }).code).toBe('INVALID_INPUT')
    expect(checkIn({ at: 'not-a-time' }).code).toBe('INVALID_INPUT')
    expect(checkIn({ order: null }).code).toBe('INVALID_INPUT')
  })

  it('可配置围栏半径，非法半径拒绝', () => {
    const far = { lat: CUSTOMER.lat + 0.01, lng: CUSTOMER.lng }
    expect(checkIn({ location: far, radiusM: 2000 }).ok).toBe(true)
    expect(checkIn({ radiusM: 0 }).code).toBe('INVALID_INPUT')
  })
})

describe('completeOrder（完成服务）', () => {
  it('打卡后拍服务后照片可完成，签字后补', () => {
    const r = completeOrder({
      order: checkedInOrder(),
      at: AT_LATER,
      photosAfter: ['wxfile://after-1.jpg'],
    })
    expect(r.ok).toBe(true)
    expect(r.order.status).toBe('completed')
    expect(r.order.completed_at).toBe(AT_LATER)
    expect(r.order.photos_after).toEqual(['wxfile://after-1.jpg'])
    expect(r.order.signature).toBeNull()
    expect(r.order.signature_pending).toBe(true)
    expect(r.order.field_events.map((e) => e.type)).toEqual(['checkin', 'complete'])
    expect(r.order.field_events[1]).toMatchObject({
      id: fieldEventId('O-FIELD-1', 'complete'),
      signature_pending: true,
    })
  })

  it('带签字完成时 signature_pending=false', () => {
    const r = completeOrder({
      order: checkedInOrder(),
      at: AT_LATER,
      photosAfter: ['wxfile://after-1.jpg'],
      signature: 'wxfile://sign.png',
    })
    expect(r.order.signature).toBe('wxfile://sign.png')
    expect(r.order.signature_pending).toBe(false)
  })

  it('重复完成幂等', () => {
    const first = completeOrder({
      order: checkedInOrder(),
      at: AT_LATER,
      photosAfter: ['wxfile://after-1.jpg'],
    })
    const second = completeOrder({
      order: first.order,
      at: '2026-11-02T12:00:00+08:00',
      photosAfter: ['wxfile://after-2.jpg'],
    })
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.order.completed_at).toBe(AT_LATER)
    expect(second.order.field_events).toHaveLength(2)
  })

  it('未打卡不能完成；没有服务后照片不能完成', () => {
    expect(
      completeOrder({ order: makeOrder(), at: AT_LATER, photosAfter: ['x.jpg'] }).code,
    ).toBe('INVALID_STATUS')
    expect(
      completeOrder({ order: checkedInOrder(), at: AT_LATER, photosAfter: [] }).code,
    ).toBe('MISSING_PHOTO')
  })

  it('完成时间非法拒绝', () => {
    expect(
      completeOrder({ order: checkedInOrder(), at: '', photosAfter: ['x.jpg'] }).code,
    ).toBe('INVALID_INPUT')
  })
})
