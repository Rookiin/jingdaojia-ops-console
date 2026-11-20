/**
 * 拍照服务：相机拍照后立即持久化到本地用户目录，避免临时路径失效。
 * 演示环境不做真实上传，仅保存本机文件路径。
 */
export function takePhotos({ count = 2 } = {}) {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      camera: 'back',
      success(res) {
        const paths = (res.tempFiles || [])
          .map((file) => file.tempFilePath)
          .filter(Boolean)
        resolve({ ok: true, paths })
      },
      fail(error) {
        const message = String(error?.errMsg || '')
        if (message.includes('cancel')) {
          resolve({ ok: false, code: 'CANCELLED', message: '已取消拍照' })
          return
        }
        resolve({
          ok: false,
          code: 'PHOTO_FAILED',
          message: '没有拍成照片，请再拍一次。',
        })
      },
    })
  })
}

/** 把临时文件保存到用户目录，返回可长期使用的路径。 */
export function persistPhotos(paths) {
  const fs = wx.getFileSystemManager()
  return paths.map((path) => {
    if (!path || path.indexOf('wxfile://') === 0 || path.indexOf('http') === 0) return path
    try {
      return fs.saveFileSync(path)
    } catch (error) {
      return path
    }
  })
}

/** 拍照 + 持久化的组合入口。 */
export async function capturePhotos(options) {
  const result = await takePhotos(options)
  if (!result.ok) return result
  return { ok: true, paths: persistPhotos(result.paths) }
}

export function previewImage(urls, current) {
  if (!urls || urls.length === 0) return
  wx.previewImage({ urls, current: current || urls[0] })
}
