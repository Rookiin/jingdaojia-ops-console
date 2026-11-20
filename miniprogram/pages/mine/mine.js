import { fileSizeText } from '../../utils/format.js'
import { readStorageInfo } from '../../services/storage.js'

Page({
  data: {
    cleaner: null,
    counts: { assigned: 0, checked_in: 0, completed: 0 },
    storageText: '',
    seedId: '',
    storageError: '',
  },

  onShow() {
    const store = getApp().globalData.store
    const state = store.getState()

    if (!state.currentCleanerId) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    const info = readStorageInfo()
    this.setData({
      cleaner: store.getCleaner(state.currentCleanerId),
      counts: store.countByStatus(state.currentCleanerId),
      storageText: `${fileSizeText(info.currentSize)} / ${fileSizeText(info.limitSize)}`,
      seedId: state.seedId,
      storageError: store.getStorageError() || '',
    })
  },

  onSwitch() {
    wx.showModal({
      title: '切换名字',
      content: '切换后需要重新选择您的名字。',
      confirmText: '切换',
      success: (res) => {
        if (!res.confirm) return
        getApp().globalData.store.clearCurrentCleaner()
        wx.reLaunch({ url: '/pages/login/login' })
      },
    })
  },

  onReset() {
    wx.showModal({
      title: '重置演示数据',
      content: '会清除本机的打卡记录和照片，恢复成今天的任务。确定要重置吗？',
      confirmText: '确定重置',
      confirmColor: '#b91c1c',
      success: (res) => {
        if (!res.confirm) return
        getApp().globalData.store.reset()
        wx.reLaunch({ url: '/pages/login/login' })
      },
    })
  },
})
