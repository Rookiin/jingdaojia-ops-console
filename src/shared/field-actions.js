/**
 * 现场作业写操作（纯函数，Web 与小程序共用）。
 *
 * 只做「已派单 → 已打卡 → 已完成」的状态推进，不创建工单、不写存储。
 * 调用方负责持久化返回的 order；所有时间由调用方注入，禁止 Date.now()。
 */
import { distanceMeters, isValidCoordinate } from './geo.js'

export const FIELD_RADIUS_M = 300

export const FIELD_EVENT_TYPE = {
  CHECK_IN: 'checkin',
  COMPLETE: 'complete',
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

function normalizePhotos(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const photos = []
  for (const item of list) {
    const path = typeof item === 'string' ? item.trim() : ''
    if (!path || seen.has(path)) continue
    seen.add(path)
    photos.push(path)
  }
  return photos
}

function mergePhotos(base, extra) {
  return normalizePhotos([...(Array.isArray(base) ? base : []), ...extra])
}

function parseTime(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? value : null
}

function fieldEvents(order) {
  return Array.isArray(order.field_events) ? order.field_events : []
}

function hasEvent(order, type) {
  return fieldEvents(order).some((event) => event && event.type === type)
}

/**
 * 现场事件幂等键：同一单同一动作只记一次。
 * @param {string} orderId
 * @param {'checkin'|'complete'} type
 */
export function fieldEventId(orderId, type) {
  return `${orderId}:${type}`
}

/**
 * 到店打卡：要求已派单、300 米内、至少一张服务前照片。
 *
 * @param {{
 *   order: Object,
 *   customer: {lat:number, lng:number},
 *   at: string,
 *   location: {lat:number, lng:number, accuracy?:number},
 *   photosBefore: string[],
 *   radiusM?: number,
 *   operator?: string
 * }} input
 * @returns {{ok:true, order:Object, event:Object, distanceM:number, idempotent?:boolean}
 *   | {ok:false, code:string, message:string, distanceM?:number|null}}
 */
export function checkInOrder(input) {
  const i = input || {}
  const order = i.order
  if (!order || typeof order.id !== 'string' || order.id.length === 0) {
    return fail('INVALID_INPUT', '缺少工单信息，无法打卡')
  }

  if (order.status === 'checked_in' && hasEvent(order, FIELD_EVENT_TYPE.CHECK_IN)) {
    return { ok: true, order, event: null, distanceM: null, idempotent: true }
  }
  if (order.status !== 'assigned') {
    return fail('INVALID_STATUS', '这张单当前不能打卡')
  }

  const at = parseTime(i.at)
  if (!at) return fail('INVALID_INPUT', '打卡时间无效，请重试')

  const radiusM =
    i.radiusM === undefined || i.radiusM === null ? FIELD_RADIUS_M : Number(i.radiusM)
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    return fail('INVALID_INPUT', '打卡范围配置无效')
  }

  const photosBefore = normalizePhotos(i.photosBefore)
  if (photosBefore.length === 0) {
    return fail('MISSING_PHOTO', '请先拍一张服务前照片')
  }

  const location = i.location
  if (!isValidCoordinate(location)) {
    return fail('MISSING_LOCATION', '未获取到定位，请打开手机定位后再试')
  }
  if (!isValidCoordinate(i.customer)) {
    return fail('INVALID_INPUT', '客户坐标缺失，请联系片区经理')
  }

  const distance = distanceMeters(location, i.customer)
  if (distance === null) {
    return fail('MISSING_LOCATION', '未获取到定位，请打开手机定位后再试')
  }
  if (distance > radiusM) {
    return fail(
      'OUT_OF_RANGE',
      `距离客户 ${distance} 米，超出 ${radiusM} 米范围，请到客户家门口再试`,
      { distanceM: distance },
    )
  }

  const accuracy = Number.isFinite(Number(location.accuracy))
    ? Number(location.accuracy)
    : null
  const event = {
    id: fieldEventId(order.id, FIELD_EVENT_TYPE.CHECK_IN),
    type: FIELD_EVENT_TYPE.CHECK_IN,
    order_id: order.id,
    at,
    operator: i.operator || order.cleaner_id || 'field',
    location: { lat: location.lat, lng: location.lng, accuracy },
    distance_m: distance,
    photos: photosBefore,
  }

  const next = {
    ...order,
    status: 'checked_in',
    checkin_at: at,
    checkin_location: {
      lat: location.lat,
      lng: location.lng,
      accuracy,
      distance_m: distance,
      at,
    },
    photos_before: mergePhotos(order.photos_before, photosBefore),
    field_events: [...fieldEvents(order), event],
    updated_at: at,
  }

  return { ok: true, order: next, event, distanceM: distance }
}

/**
 * 完成服务：要求已打卡、至少一张服务后照片；客户签字允许后补。
 *
 * @param {{
 *   order: Object,
 *   at: string,
 *   photosAfter: string[],
 *   signature?: string|null,
 *   operator?: string
 * }} input
 * @returns {{ok:true, order:Object, event:Object, idempotent?:boolean}
 *   | {ok:false, code:string, message:string}}
 */
export function completeOrder(input) {
  const i = input || {}
  const order = i.order
  if (!order || typeof order.id !== 'string' || order.id.length === 0) {
    return fail('INVALID_INPUT', '缺少工单信息，无法完成')
  }

  if (order.status === 'completed' && hasEvent(order, FIELD_EVENT_TYPE.COMPLETE)) {
    return { ok: true, order, event: null, idempotent: true }
  }
  if (order.status !== 'checked_in') {
    return fail('INVALID_STATUS', '这张单还没有打卡，不能完成')
  }

  const at = parseTime(i.at)
  if (!at) return fail('INVALID_INPUT', '完成时间无效，请重试')

  const photosAfter = normalizePhotos(i.photosAfter)
  if (photosAfter.length === 0) {
    return fail('MISSING_PHOTO', '请先拍一张服务后照片')
  }

  const signature =
    typeof i.signature === 'string' && i.signature.trim().length > 0
      ? i.signature.trim()
      : order.signature || null
  const signaturePending = !signature

  const event = {
    id: fieldEventId(order.id, FIELD_EVENT_TYPE.COMPLETE),
    type: FIELD_EVENT_TYPE.COMPLETE,
    order_id: order.id,
    at,
    operator: i.operator || order.cleaner_id || 'field',
    signature_pending: signaturePending,
    photos: photosAfter,
  }

  const next = {
    ...order,
    status: 'completed',
    completed_at: at,
    photos_after: mergePhotos(order.photos_after, photosAfter),
    signature,
    signature_pending: signaturePending,
    field_events: [...fieldEvents(order), event],
    updated_at: at,
  }

  return { ok: true, order: next, event }
}
