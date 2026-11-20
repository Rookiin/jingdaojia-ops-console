import { describe, expect, it } from 'vitest'
import { calcCompensation, decideResponsibility } from '../responsibility.js'
import { emptyEvidenceOrder, fullEvidenceOrder } from './fixtures.js'

const WITHIN_72H = '2026-10-01T12:00:00+08:00'

function decide(overrides = {}) {
  return decideResponsibility({
    order: fullEvidenceOrder(),
    complaintAt: WITHIN_72H,
    claimAmount: 15_000,
    hasCustomerPrePhoto: false,
    productDefectEvidence: false,
    priorSameTypeCount: 0,
    source: 'auto',
    ...overrides,
  })
}

describe('decideResponsibility（A6 / A7 / A8 与边界）', () => {
  it('A6：全证据工单评分 100，自动定责为阿姨', () => {
    const r = decide()
    expect(r.evidenceScore).toBe(100)
    expect(r.responsibility).toBe('cleaner')
    expect(r.requiresManualReview).toBe(false)
    expect(r.maxApprovalRole).toBe('district_manager')
    expect(r.reasons.join()).toContain('规则 4')
  })

  it('A7：无证据工单评分为 0 → 待定，且不是 none', () => {
    const r = decide({
      order: emptyEvidenceOrder(),
      complaintAt: null,
      claimAmount: 0,
    })
    expect(r.evidenceScore).toBe(0)
    expect(r.responsibility).toBe('undetermined')
    expect(r.responsibility).not.toBe('none')
    expect(r.requiresManualReview).toBe(true)
  })

  it('A8：人工路径必须带理由才能给出 none', () => {
    const r = decide({
      order: emptyEvidenceOrder(),
      source: 'manual',
      manualReason: '客户自身使用不当，已现场确认',
      manualResponsibility: 'none',
    })
    expect(r.responsibility).toBe('none')
    expect(r.requiresManualReview).toBe(false)
    expect(r.reasons.join()).toContain('人工定责')
  })

  it('人工路径缺少理由时退回自动判定', () => {
    const r = decide({
      order: emptyEvidenceOrder(),
      complaintAt: null,
      source: 'manual',
      manualReason: '   ',
      manualResponsibility: 'none',
    })
    expect(r.responsibility).toBe('undetermined')
  })

  it('耗材缺陷证据 → product；客户有服务前照片且无新增损坏 → customer', () => {
    const product = decide({ productDefectEvidence: true })
    expect(product.responsibility).toBe('product')
    expect(product.requiresManualReview).toBe(false)

    const customer = decide({ hasCustomerPrePhoto: true })
    expect(customer.responsibility).toBe('customer')
    expect(customer.requiresManualReview).toBe(false)
  })

  it('证据分 65（无签字 + 投诉超 72h）→ 待定，需人工复核', () => {
    const order = fullEvidenceOrder()
    order.signature = null
    const r = decide({
      order,
      complaintAt: '2026-10-10T12:00:00+08:00',
    })
    expect(r.evidenceScore).toBe(65)
    expect(r.responsibility).toBe('undetermined')
    expect(r.requiresManualReview).toBe(true)
    expect(r.reasons.join()).toContain('[40,70)')
  })

  it('赔付金额 >300 元需二次审批，>500 元升级财务终审', () => {
    const mid = decide({ claimAmount: 30_001 })
    expect(mid.responsibility).toBe('cleaner')
    expect(mid.requiresManualReview).toBe(true)

    const big = decide({ claimAmount: 50_001 })
    expect(big.maxApprovalRole).toBe('finance')
    expect(big.requiresManualReview).toBe(true)
    expect(big.reasons.join()).toContain('财务终审')
  })

  it('同类历史 ≥2 次只追加建议，不改变责任方', () => {
    const r = decide({ priorSameTypeCount: 2 })
    expect(r.responsibility).toBe('cleaner')
    expect(r.reasons.join()).toContain('≥2 次')
  })

  it('非法 claimAmount 抛出 INVALID_INPUT', () => {
    expect(() => decide({ claimAmount: -1 })).toThrow(/claimAmount/)
    expect(() => decide({ claimAmount: 'x' })).toThrow(/claimAmount/)
  })
})

describe('calcCompensation（应付与追偿）', () => {
  it('cleaner：应付=追偿=索赔额，并提示提成 30% 上限', () => {
    const r = calcCompensation({ claimAmount: 15_000, responsibility: 'cleaner' })
    expect(r.payable).toBe(15_000)
    expect(r.recoverable).toBe(15_000)
    expect(r.warnings.join()).toContain('30%')
  })

  it('product：应付索赔额、不向客户追偿，提示供应商追偿', () => {
    const r = calcCompensation({ claimAmount: 15_000, responsibility: 'product' })
    expect(r.payable).toBe(15_000)
    expect(r.recoverable).toBe(0)
    expect(r.warnings.join()).toContain('供应商')
  })

  it('undetermined 按上限应付、不追偿；none 应付追偿均为 0', () => {
    const un = calcCompensation({ claimAmount: 15_000, responsibility: 'undetermined' })
    expect(un).toMatchObject({ payable: 15_000, recoverable: 0 })

    const none = calcCompensation({ claimAmount: 15_000, responsibility: 'none' })
    expect(none).toMatchObject({ payable: 0, recoverable: 0 })
  })

  it('超过默认上限 3000 元截断并告警；可传入自定义上限', () => {
    const r = calcCompensation({ claimAmount: 400_000, responsibility: 'undetermined' })
    expect(r.payable).toBe(300_000)
    expect(r.warnings.join()).toContain('上限')

    const custom = calcCompensation({
      claimAmount: 400_000,
      responsibility: 'undetermined',
      cap: 500_000,
    })
    expect(custom.payable).toBe(400_000)
  })

  it('未知责任方 / 负索赔额抛出 INVALID_INPUT', () => {
    expect(() =>
      calcCompensation({ claimAmount: 1, responsibility: 'invalid' }),
    ).toThrow(/未知责任方/)
    expect(() =>
      calcCompensation({ claimAmount: -1, responsibility: 'none' }),
    ).toThrow(/claimAmount/)
  })
})
