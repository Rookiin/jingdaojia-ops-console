import { Card, EmptyState } from '../../components/ui.jsx'

/** M1 工单追溯（占位桩，后续代理实现）。 */
export default function OrdersPage() {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M1</span>
          <h1>工单追溯</h1>
          <p className="muted">工单列表、新建派单、状态流转、时间线与证据链</p>
        </div>
      </header>
      <Card title="工单追溯">
        <EmptyState
          title="工单追溯 · 建设中"
          hint="此后将接入筛选、批量派单、工单详情、投诉/赔付关联与状态机校验。"
        />
      </Card>
    </section>
  )
}
