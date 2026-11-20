import { Component, useState } from 'react'
import { useStore } from './store.js'
import { resetDemoData } from './store/actions.js'
import { EmptyState } from './components/ui.jsx'
import OrdersPage from './features/orders/Page.jsx'
import CompensationsPage from './features/compensations/Page.jsx'
import CleanersPage from './features/cleaners/Page.jsx'
import CustomersPage from './features/customers/Page.jsx'
import PnlPage from './features/pnl/Page.jsx'

const TABS = [
  { id: 'orders', code: 'M1', label: '工单追溯', Component: OrdersPage },
  { id: 'compensations', code: 'M2', label: '赔付管理', Component: CompensationsPage },
  { id: 'cleaners', code: 'M3', label: '阿姨工时提成', Component: CleanersPage },
  { id: 'customers', code: 'M4', label: '客户档案', Component: CustomersPage },
  { id: 'pnl', code: 'M5', label: '片区损益', Component: PnlPage },
]

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          title="页面渲染失败"
          hint={String(this.state.error.message || this.state.error)}
        />
      )
    }
    return this.props.children
  }
}

export default function App() {
  const [active, setActive] = useState('orders')
  const [resetNotice, setResetNotice] = useState(null)
  const period = useStore((s) => s.meta?.period || '—')
  const storageError = useStore((s) => s.meta?.storageError || null)
  const validationErrors = useStore((s) => s.meta?.validationErrors || null)
  const districtCount = useStore((s) => s.districts.length)
  const cleanerCount = useStore((s) => s.cleaners.length)
  const orderCount = useStore((s) => s.orders.length)

  const current = TABS.find((tab) => tab.id === active) || TABS[0]
  const CurrentPage = current.Component

  function handleReset() {
    const confirmed =
      typeof window === 'undefined' || typeof window.confirm !== 'function'
        ? true
        : window.confirm('将清空本地修改并恢复基线演示数据，确定继续？')
    if (!confirmed) return
    const result = resetDemoData()
    setResetNotice(result.ok ? '已恢复基线数据' : `重置失败：${result.code}`)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            净
          </span>
          <div className="brand-text">
            <strong>净到家保洁</strong>
            <span>片区经营看板</span>
          </div>
        </div>
        <div className="header-meta">
          <span className="header-meta-item">
            账期 <b>{period}</b>
          </span>
          <span className="header-meta-item">
            {districtCount} 片区 · {cleanerCount} 阿姨 · {orderCount} 工单
          </span>
          <button type="button" className="btn" onClick={handleReset}>
            重置演示数据
          </button>
          {resetNotice && (
            <span className="header-meta-item" role="status">
              {resetNotice}
            </span>
          )}
        </div>
      </header>

      <nav className="tab-nav" role="tablist" aria-label="业务模块">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className={`tab-btn${tab.id === active ? ' is-active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            <span className="tab-code">{tab.code}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      {(storageError || validationErrors) && (
        <div className="notice-banner" role="status">
          {storageError || `种子校验失败：${validationErrors.length} 项`}
        </div>
      )}

      <main className="app-main">
        <PageErrorBoundary key={active}>
          <CurrentPage />
        </PageErrorBoundary>
      </main>

      <footer className="app-footer">
        数据全部虚构 · 仅供教学演示 · 金额以分存储、按元展示
      </footer>
    </div>
  )
}
