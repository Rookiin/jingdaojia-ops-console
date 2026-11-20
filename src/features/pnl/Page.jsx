import { Card, EmptyState } from '../../components/ui.jsx'

/** M5 片区损益（占位桩，后续代理实现）。 */
export default function PnlPage() {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M5</span>
          <h1>片区损益</h1>
          <p className="muted">8 片区净利排行、损益科目下钻、趋势与堵漏模拟</p>
        </div>
      </header>
      <Card title="片区损益">
        <EmptyState
          title="片区损益 · 建设中"
          hint="此后将接入损益表、三大漏损下钻、14 个月趋势与假设模拟器。"
        />
      </Card>
    </section>
  )
}
