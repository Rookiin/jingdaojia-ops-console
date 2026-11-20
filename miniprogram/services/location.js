/**
 * 定位服务：获取当前位置、引导授权、在地图里打开客户地址。
 * 失败时返回可读中文提示，供页面直接展示给阿姨。
 */
export function getCurrentLocation() {
  return new Promise((resolve) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success(res) {
        resolve({
          ok: true,
          location: {
            lat: res.latitude,
            lng: res.longitude,
            accuracy: res.accuracy || null,
          },
        })
      },
      fail(error) {
        const message = String(error?.errMsg || '')
        if (message.includes('auth deny') || message.includes('authorize')) {
          resolve({
            ok: false,
            code: 'LOCATION_DENIED',
            message: '还没有开启定位权限。请点“去设置”打开位置信息，再回来打卡。',
          })
          return
        }
        resolve({
          ok: false,
          code: 'LOCATION_FAILED',
          message: '暂时拿不到位置，请走到空旷处再试，或开启手机定位。',
        })
      },
    })
  })
}

export function openSetting() {
  return new Promise((resolve) => {
    wx.openSetting({
      success: (res) => resolve(res.authSetting || {}),
      fail: () => resolve({}),
    })
  })
}

/** 用微信内置地图打开客户地址（适老：不用自己记路）。 */
export function openCustomerMap(customer) {
  if (!customer || !Number.isFinite(customer.lat) || !Number.isFinite(customer.lng)) {
    wx.showToast({ title: '地址坐标缺失', icon: 'none' })
    return
  }
  wx.openLocation({
    latitude: customer.lat,
    longitude: customer.lng,
    name: customer.name,
    address: customer.address,
    scale: 18,
  })
}
