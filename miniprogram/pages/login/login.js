Page({
  data: {
    cleaners: [],
    selectedId: '',
    seedId: '',
  },

  onShow() {
    const store = getApp().globalData.store
    const state = store.getState()

    if (state.currentCleanerId) {
      wx.switchTab({ url: '/pages/tasks/tasks' })
      return
    }

    const cleaners = state.cleaners.map((cleaner) => {
      const pending = state.tasks.filter(
        (task) => task.cleaner_id === cleaner.id && task.status !== 'completed',
      ).length
      return {
        id: cleaner.id,
        name: cleaner.name,
        phoneTail: String(cleaner.phone_masked || '').slice(-4),
        district: cleaner.district_id === 'D-XXT' ? '西乡塘' : '青秀',
        pendingText: pending > 0 ? `有 ${pending} 个任务` : '暂无任务',
      }
    })

    this.setData({ cleaners, seedId: state.seedId })
  },

  onSelect(event) {
    this.setData({ selectedId: event.currentTarget.dataset.id })
  },

  onEnter() {
    if (!this.data.selectedId) {
      wx.showToast({ title: '请先点一下您的名字', icon: 'none', duration: 2000 })
      return
    }
    getApp().globalData.store.setCurrentCleaner(this.data.selectedId)
    wx.switchTab({ url: '/pages/tasks/tasks' })
  },
})
