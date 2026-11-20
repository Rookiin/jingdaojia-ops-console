/**
 * 净到家阿姨端（演示）。
 *
 * 数据全部虚构，仅保存在本机；不连接后端、不创建工单，
 * 只对既有工单做「已派单 → 已打卡 → 已完成」的状态推进。
 */
import { createStore } from './store.js'

App({
  globalData: {
    store: null,
  },

  onLaunch() {
    this.globalData.store = createStore()
  },
})
