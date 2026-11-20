import { distanceMeters } from '../../core/geo.js'
import { capturePhotos, previewImage } from '../../services/media.js'
import { getCurrentLocation, openCustomerMap, openSetting } from '../../services/location.js'
import { amountText, dateText, nowIso, statusText, timeText } from '../../utils/format.js'

const STEPS = [
  { key: 'assigned', label: '接单' },
  { key: 'checked_in', label: '打卡' },
  { key: 'completed', label: '完成' },
]

function buildSteps(status) {
  const order = { assigned: 0, checked_in: 1, completed: 2 }[status]
  return STEPS.map((step, index) => ({
    ...step,
    state: index < order ? 'is-done' : index === order ? 'is-active' : '',
  }))
}

Page({
  data: {
    task: null,
    customer: null,
    orderNo: '',
    statusLabel: '',
    scheduleText: '',
    amountLabel: '',
    checkinText: '',
    photosBefore: [],
    photosAfter: [],
    locationText: '',
    distanceLabel: '',
    inRange: false,
    steps: [],
    signaturePending: false,
    busy: false,
  },

  onLoad(query) {
    this.taskId = query.id
    this.tempLocation = null
    this.refresh()
  },

  onShow() {
    if (this.taskId) this.refresh()
  },

  refresh() {
    const store = getApp().globalData.store
    const task = store.getTask(this.taskId)

    if (!task) {
      wx.showModal({
        title: '找不到这张单',
        content: '请返回任务列表刷新后再试。',
        showCancel: false,
        success: () => wx.navigateBack(),
      })
      return
    }

    const customer = store.getCustomer(task.customer_id)
    const distance =
      this.tempLocation && customer
        ? distanceMeters(this.tempLocation, { lat: customer.lat, lng: customer.lng })
        : null

    this.setData({
      task,
      customer,
      orderNo: task.order_no,
      statusLabel: statusText(task.status),
      scheduleText: `${dateText(task.scheduled_at)} ${timeText(task.scheduled_at)}`,
      amountLabel: amountText(task.amount),
      checkinText: task.checkin_at
        ? `已于 ${dateText(task.checkin_at)} ${timeText(task.checkin_at)} 打卡`
        : '还没有打卡',
      photosBefore: task.photos_before || [],
      photosAfter: task.photos_after || [],
      distanceLabel: distance === null ? '' : `距离客户约 ${distance} 米`,
      inRange: distance !== null && distance <= (store.getState().radiusM || 300),
      steps: buildSteps(task.status),
      signaturePending: Boolean(task.signature_pending),
    })
  },

  async onGetLocation() {
    const result = await getCurrentLocation()
    if (!result.ok) {
      wx.showModal({
        title: '还不能打卡',
        content: result.message,
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) openSetting()
        },
      })
      return
    }
    this.tempLocation = result.location
    this.refresh()
    wx.showToast({ title: '已获取位置', icon: 'success' })
  },

  async onTakeBefore() {
    const result = await capturePhotos({ count: 2 })
    if (!result.ok) {
      if (result.code !== 'CANCELLED') wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    const photos = this.data.photosBefore.concat(result.paths).slice(0, 3)
    this.setData({ photosBefore: photos })
  },

  async onTakeAfter() {
    const result = await capturePhotos({ count: 2 })
    if (!result.ok) {
      if (result.code !== 'CANCELLED') wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    const photos = this.data.photosAfter.concat(result.paths).slice(0, 3)
    this.setData({ photosAfter: photos })
  },

  onPreview(event) {
    const { group, index } = event.currentTarget.dataset
    const urls = group === 'after' ? this.data.photosAfter : this.data.photosBefore
    previewImage(urls, urls[Number(index)])
  },

  onCheckIn() {
    if (!this.tempLocation) {
      wx.showToast({ title: '请先点“获取我的位置”', icon: 'none' })
      return
    }
    if (this.data.photosBefore.length === 0) {
      wx.showToast({ title: '请先拍一张服务前照片', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认打卡',
      content: `将记录当前位置（${this.data.distanceLabel || '位置已获取'}）并保存服务前照片。`,
      confirmText: '确认打卡',
      success: (res) => {
        if (!res.confirm) return
        this.submitCheckIn()
      },
    })
  },

  submitCheckIn() {
    const store = getApp().globalData.store
    const result = store.checkIn(this.taskId, {
      at: nowIso(),
      location: this.tempLocation,
      photosBefore: this.data.photosBefore,
    })

    if (!result.ok) {
      wx.showModal({ title: '打卡未成功', content: result.message, showCancel: false, confirmText: '知道了' })
      return
    }
    if (result.idempotent) {
      wx.showToast({ title: '已经打过卡了', icon: 'none' })
      this.refresh()
      return
    }
    this.setData({ busy: false })
    this.refresh()
    wx.showModal({
      title: '打卡成功',
      content: '请开始服务。做完后拍服务后照片，再点最下面的“完成服务”。',
      showCancel: false,
      confirmText: '好的',
    })
  },

  onComplete() {
    if (this.data.task.status !== 'checked_in') {
      wx.showToast({ title: '请先完成打卡', icon: 'none' })
      return
    }
    if (this.data.photosAfter.length === 0) {
      wx.showToast({ title: '请先拍一张服务后照片', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认完成服务',
      content: '完成后这张单会变成“已完成”，客户签字由办公室在看板补录。',
      confirmText: '确认完成',
      success: (res) => {
        if (!res.confirm) return
        this.submitComplete()
      },
    })
  },

  submitComplete() {
    const store = getApp().globalData.store
    const result = store.complete(this.taskId, {
      at: nowIso(),
      photosAfter: this.data.photosAfter,
    })

    if (!result.ok) {
      wx.showModal({ title: '没有完成', content: result.message, showCancel: false, confirmText: '知道了' })
      return
    }
    if (result.idempotent) {
      wx.showToast({ title: '这张单已经完成了', icon: 'none' })
      this.refresh()
      return
    }
    wx.showModal({
      title: '完成啦',
      content: '已记录完成时间与服务后照片。辛苦啦！',
      showCancel: false,
      confirmText: '返回任务',
      success: () => wx.navigateBack(),
    })
  },

  onMap() {
    openCustomerMap(this.data.customer)
  },
})
