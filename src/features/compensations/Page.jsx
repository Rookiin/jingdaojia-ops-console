import { Card, EmptyState } from '../../components/ui.jsx'

/** M2 赔付管理（占位桩，后续代理实现）。 */
export default function CompensationsPage() {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M2</span>
          <h1>赔付管理</h1>
          <p className="muted">待定责、待审批、无法定责清单与证据评分</p>
        </div>
      </header>
      <Card title="赔付管理">
        <EmptyState
          title="赔付管理 · 建设中"
          hint="此后将接入定责规则、证据面板、审批链与幂等入账。"
        />
      </Card>
    </section>
  )
}
