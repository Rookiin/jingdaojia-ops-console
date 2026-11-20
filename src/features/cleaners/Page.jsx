import { Card, EmptyState } from '../../components/ui.jsx'

/** M3 阿姨工时提成（占位桩，后续代理实现）。 */
export default function CleanersPage() {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="page-code">M3</span>
          <h1>阿姨工时提成</h1>
          <p className="muted">工时、质量系数、提成明细与月结锁定</p>
        </div>
      </header>
      <Card title="阿姨工时提成">
        <EmptyState
          title="阿姨工时提成 · 建设中"
          hint="此后将接入逐单提成、质量系数、月结生成/锁定/红冲与 CSV 导出。"
        />
      </Card>
    </section>
  )
}
