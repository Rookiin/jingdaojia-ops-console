/**
 * 小程序本地持久化适配（唯一接触 wx.storage 的地方）。
 */
const STORAGE_KEY = 'njdao:mp:v1'
const STORAGE_VERSION = 1

let storageError = null

export function getStorageError() {
  return storageError
}

export function readStoredState() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    storageError = null
    if (!raw) return null
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!payload || payload.version !== STORAGE_VERSION || !payload.state) return null
    return payload.state
  } catch (error) {
    storageError = `读取本地数据失败：${error.errMsg || error.message || '未知错误'}`
    return null
  }
}

export function writeStoredState(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, { version: STORAGE_VERSION, state })
    storageError = null
  } catch (error) {
    storageError = `保存本地数据失败：${error.errMsg || error.message || '未知错误'}`
  }
}

export function clearStoredState() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (error) {
    storageError = `清空本地数据失败：${error.errMsg || error.message || '未知错误'}`
  }
}

export function readStorageInfo() {
  try {
    const info = wx.getStorageInfoSync()
    return {
      currentSize: info.currentSize || 0,
      limitSize: info.limitSize || 0,
    }
  } catch (error) {
    return { currentSize: 0, limitSize: 0 }
  }
}

export { STORAGE_KEY, STORAGE_VERSION }
