import { dateText, statusText, timeText } from '../../utils/format.js'

function decorate(task, store) {
  const customer = store.getCustomer(task.customer_id)
  return {
    id: task.id,
    orderNo: task.order_no,
    status: task.status,
    statusText: statusText(task.status),
    dateText: dateText(task.scheduled_at),
    timeText: timeText(task.scheduled_at),
    customerName: customer ? customer.name : '客户',
    address: customer ? customer.address : '地址缺失',
    actionText:
      task.status === 'assigned'
        ? '去打卡'
        : task.status === 'checked_in'
          ? '继续完成'
          : '已完成',
  }
}

Page({
  data: {
    cleanerName: '',
    counts: { assigned: 0, checked_in: 0, completed: 0 },
    tasks: [],
    storageError: '',
  },

  onShow() {
    const store = getApp().globalData.store
    const state = store.getState()

    if (!state.currentCleanerId) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    const cleaner = store.getCleaner(state.currentCleanerId)
    const tasks = store
      .getTasksForCleaner(state.currentCleanerId)
      .map((task) => decorate(task, store))

    this.setData({
      cleanerName: cleaner ? cleaner.name : '',
      counts: store.countByStatus(state.currentCleanerId),
      tasks,
      storageError: store.getStorageError() || '',
    })
  },

  onPullDownRefresh() {
    this.onShow()
    wx.stopPullDownRefresh()
  },

  openTask(event) {
    const id = event.currentTarget.dataset.id
    const task = getApp().globalData.store.getTask(id)
    if (!task) return
    if (task.status === 'completed') {
      wx.showModal({
        title: '这张单已经完成',
        content: '不需要再操作了，可以去“我的”看看今天完成了几单。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },
})
