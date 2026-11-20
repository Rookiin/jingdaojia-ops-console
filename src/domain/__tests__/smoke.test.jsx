/**
 * SSR 冒烟：在 Node 环境把 5 个页面与整壳渲染成字符串。
 * 用于证明「页面不依赖浏览器 API、可无崩溃渲染」，不含交互断言。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import App from '../../App.jsx'
import OrdersPage from '../../features/orders/Page.jsx'
import CompensationsPage from '../../features/compensations/Page.jsx'
import CleanersPage from '../../features/cleaners/Page.jsx'
import CustomersPage from '../../features/customers/Page.jsx'
import PnlPage from '../../features/pnl/Page.jsx'
import { loadSeed } from '../../data/loader.js'

beforeEach(() => {
  loadSeed({ force: true })
})

const PAGES = [
  ['M1 工单追溯', OrdersPage, '工单追溯'],
  ['M2 赔付管理', CompensationsPage, '赔付管理'],
  ['M3 阿姨工时提成', CleanersPage, '阿姨工时提成'],
  ['M4 客户档案', CustomersPage, '客户档案'],
  ['M5 片区损益', PnlPage, '片区损益'],
]

describe('SSR 冒烟（种子注入后逐页渲染）', () => {
  for (const [name, Page, heading] of PAGES) {
    it(`${name} 可渲染且含标题`, () => {
      const html = renderToString(createElement(Page))
      expect(html.length).toBeGreaterThan(500)
      expect(html).toContain(heading)
      expect(html).not.toContain('页面渲染失败')
    })
  }

  it('应用外壳含 5 个模块页签与账期', () => {
    const html = renderToString(createElement(App))
    for (const [, , heading] of PAGES) {
      expect(html).toContain(heading)
    }
    expect(html).toContain('2026-10')
    expect(html).toContain('净到家保洁')
    expect(html).not.toContain('页面渲染失败')
  })
})
