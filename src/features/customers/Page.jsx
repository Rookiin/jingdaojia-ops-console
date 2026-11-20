import { Card, EmptyState } from '../../components/ui.jsx'

/** M4 客户档案（占位桩，后续代理实现）。 */
export default function CustomersPage() {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M4</span>
          <h1>客户档案</h1>
          <p className="muted">客户 360、流失预警、历史单与风险提示</p>
        </div>
      </header>
      <Card title="客户档案">
        <EmptyState
          title="客户档案 · 建设中"
          hint="此后将接入客户列表、客户 360、投诉/赔付关联与脱敏导出。"
        />
      </Card>
    </section>
  )
}
