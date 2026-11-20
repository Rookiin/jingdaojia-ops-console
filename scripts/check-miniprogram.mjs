/**
 * 小程序结构与共享内核一致性校验（只读）。
 *
 * 用法：npm run check:mp（已并入 npm run verify）
 * 校验点：
 * 1. MANIFEST 存在，生成文件哈希与磁盘一致；
 * 2. 源文件哈希与清单一致（防止改了源文件忘记同步）；
 * 3. app.json / project.config.json 结构、页面四件套齐全；
 * 4. core/ 保持纯函数（无 wx API、无 Node API、无 CommonJS）；
 * 5. 全仓 miniprogram 不出现 createOrder（阿姨端不得建单）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const MP_DIR = join(ROOT, 'miniprogram')

const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function pass(message) {
  notes.push(message)
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${label} 解析失败：${error.message}`)
    return null
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/* 1 & 2. 清单与哈希 */
const manifestPath = join(MP_DIR, 'MANIFEST.json')
if (!existsSync(manifestPath)) {
  fail('缺少 miniprogram/MANIFEST.json，请先执行 npm run sync:mp')
} else {
  const manifest = readJson(manifestPath, 'MANIFEST.json')
  if (manifest) {
    for (const [rel, hash] of Object.entries(manifest.files || {})) {
      const target = join(MP_DIR, rel)
      if (!existsSync(target)) {
        fail(`生成文件缺失：miniprogram/${rel}`)
        continue
      }
      if (sha256(readFileSync(target, 'utf8')) !== hash) {
        fail(`生成文件与清单不一致：miniprogram/${rel}（请重新执行 npm run sync:mp）`)
      }
    }
    for (const [source, hash] of Object.entries(manifest.sources || {})) {
      const path = join(ROOT, source)
      if (!existsSync(path)) {
        fail(`源文件缺失：${source}`)
        continue
      }
      if (sha256(readFileSync(path, 'utf8')) !== hash) {
        fail(`源文件已变更但未同步：${source}（请执行 npm run sync:mp）`)
      }
    }
    if (failures.length === 0) pass('共享内核与清单一致')
  }
}

/* 3. 工程配置与页面 */
const appJsonPath = join(MP_DIR, 'app.json')
const pages = []
if (!existsSync(appJsonPath)) {
  fail('缺少 miniprogram/app.json')
} else {
  const appJson = readJson(appJsonPath, 'app.json')
  if (appJson) {
    pages.push(...(appJson.pages || []))
    if (pages.length === 0) fail('app.json 未声明任何页面')
    for (const page of pages) {
      for (const ext of ['js', 'wxml', 'json']) {
        const file = join(MP_DIR, `${page}.${ext}`)
        if (!existsSync(file)) fail(`页面文件缺失：miniprogram/${page}.${ext}`)
      }
    }
    const tabBar = appJson.tabBar
    if (!tabBar || !Array.isArray(tabBar.list) || tabBar.list.length < 2) {
      fail('app.json tabBar 至少需要 2 个 tab')
    } else {
      for (const item of tabBar.list) {
        if (!pages.includes(item.pagePath)) {
          fail(`tabBar 页面未在 pages 中注册：${item.pagePath}`)
        }
        if (!item.text || item.text.length > 4) {
          fail(`tabBar 文案需 1–4 个字：${item.text}`)
        }
      }
    }
    const desc = appJson.permission?.['scope.userLocation']?.desc
    if (!desc) fail('app.json 缺少 permission.scope.userLocation.desc')
    if (!Array.isArray(appJson.requiredPrivateInfos) ||
      !appJson.requiredPrivateInfos.includes('getLocation')) {
      fail('app.json requiredPrivateInfos 必须声明 getLocation')
    }
  }
}

const projectConfigPath = join(MP_DIR, 'project.config.json')
if (!existsSync(projectConfigPath)) {
  fail('缺少 miniprogram/project.config.json')
} else {
  const projectConfig = readJson(projectConfigPath, 'project.config.json')
  if (projectConfig) {
    if (!projectConfig.appid) fail('project.config.json 缺少 appid')
    const es6 = projectConfig.setting?.es6 ?? projectConfig.es6
    if (es6 !== true) fail('project.config.json 需开启 es6 编译（setting.es6 = true）')
  }
}

if (!existsSync(join(MP_DIR, 'sitemap.json'))) fail('缺少 miniprogram/sitemap.json')

/* 4. core 纯净性 */
const coreFiles = walk(join(MP_DIR, 'core'))
if (coreFiles.length === 0) fail('miniprogram/core 为空，请执行 npm run sync:mp')
const forbidden = [
  { pattern: /\bwx\./, label: 'wx API' },
  { pattern: /\brequire\s*\(/, label: 'CommonJS require' },
  { pattern: /\bmodule\.exports\b/, label: 'CommonJS exports' },
  { pattern: /\bprocess\./, label: 'Node process' },
  { pattern: /from\s+['"]node:/, label: 'Node 内置模块' },
]
for (const file of coreFiles) {
  const text = readFileSync(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      fail(`core 文件出现 ${rule.label}：${file.replace(ROOT, '').replace(/\\/g, '/')}`)
    }
  }
}
if (coreFiles.length > 0) pass(`core 共 ${coreFiles.length} 个纯函数文件`)

/* 5. 阿姨端不得建单 */
const mpFiles = walk(MP_DIR).filter((file) => /\.(js|wxml|json)$/.test(file))
for (const file of mpFiles) {
  const rel = file.replace(ROOT, '').replace(/\\/g, '/')
  if (rel.endsWith('MANIFEST.json')) continue
  const text = readFileSync(file, 'utf8')
  if (/\bcreateOrder\b/.test(text)) {
    fail(`阿姨端不得创建工单，但出现 createOrder：${rel}`)
  }
}
pass(`检查文件 ${mpFiles.length} 个`)

/* 输出 */
console.log('[check:mp] 小程序结构与内核一致性校验')
for (const note of notes) console.log(`  ✓ ${note}`)
if (failures.length > 0) {
  for (const message of failures) console.error(`  ✗ ${message}`)
  console.error(`[check:mp] 失败 ${failures.length} 项`)
  process.exitCode = 1
} else {
  console.log('[check:mp] 全部通过')
}
