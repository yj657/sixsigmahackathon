import { describe, expect, it } from 'vitest'
import {
  IMR_ASSUMPTION,
  MSG_BELOW,
  MSG_MEETS,
  NOT_A_GUARANTEE,
  decisionHeadline,
  hazardPattern,
  historyCallLabel,
  historyNeedsAttention,
  imrBasis,
  weibullAssumption,
  weibullBasis,
} from './resultText.js'

// Shapes of real /analyze responses (values from the baseline sample, see demo/README.md).
const meets = {
  call: 'ok to fly',
  meets_threshold: true,
  decision_message: MSG_MEETS,
  n: 5,
  r: 3,
  current_age: 0,
  plan_hours: 50,
  m: 2,
}
const below = {
  call: 'maintain now',
  meets_threshold: false,
  decision_message: MSG_BELOW,
  n: 5,
  r: 3,
  current_age: 150,
  plan_hours: 50,
  m: 2,
}

describe('decision messages', () => {
  it('shows the backend sentence, never "ok to fly"', () => {
    expect(decisionHeadline(meets)).toBe(
      'Model-estimated reliability meets the 90% threshold.',
    )
    expect(decisionHeadline(below)).toBe(
      'Model-estimated reliability is below the 90% threshold; maintenance review is recommended.',
    )
    expect(decisionHeadline(meets)).not.toMatch(/ok to fly/i)
  })

  it('words older saved results (no decision_message) with the same 90% rule', () => {
    expect(decisionHeadline({ call: 'ok to fly' })).toBe(MSG_MEETS)
    expect(decisionHeadline({ call: 'maintain now' })).toBe(MSG_BELOW)
  })

  it('labels History rows by the threshold, and keeps I-MR labels', () => {
    expect(historyCallLabel({ kind: 'weibull-m2', call: 'ok to fly', detail: { result: meets } })).toBe(
      'Meets 90% threshold',
    )
    expect(historyCallLabel({ kind: 'free-m', call: 'maintain now', detail: { result: below } })).toBe(
      'Below 90% threshold',
    )
    expect(historyCallLabel({ kind: 'imr', call: 'shift flagged' })).toBe('shift flagged')
    expect(historyNeedsAttention({ kind: 'weibull-m2', call: 'maintain now', detail: { result: below } })).toBe(true)
    expect(historyNeedsAttention({ kind: 'imr', call: 'looks steady' })).toBe(false)
  })

  it('carries a not-a-guarantee notice', () => {
    expect(NOT_A_GUARANTEE).toMatch(/not a guarantee of flight safety/)
  })
})

describe('sample size, failures, age and planned hours', () => {
  it('lists all four for every Weibull result', () => {
    const basis = Object.fromEntries(weibullBasis(below).map((b) => [b.key, b]))
    expect(basis.n).toMatchObject({ label: 'Observations (drones)', value: '5' })
    expect(basis.r).toMatchObject({ label: 'Recorded failures', value: '3' })
    expect(basis.age).toMatchObject({ label: 'Drone age now', value: '150 flight hours' })
    expect(basis.plan).toMatchObject({
      label: 'Planned additional flight hours',
      value: '50 flight hours',
    })
  })

  it('treats a missing age (older saved result) as a new drone', () => {
    const { current_age, ...old } = meets
    expect(weibullBasis(old).find((b) => b.key === 'age').value).toBe('0 flight hours')
  })

  it('lists the number of missions for I-MR', () => {
    expect(imrBasis({ n: 9 })).toEqual([{ key: 'n', label: 'Missions analysed', value: '9' }])
  })
})

describe('model assumptions', () => {
  it('fixed m = 2 states the fixed shape and the increasing hazard', () => {
    const a = weibullAssumption(meets, false)
    expect(a.summary).toMatch(/shape fixed at m = 2/)
    expect(a.summary).toMatch(/failure rate rises with age/)
  })

  it('free-m says the shape is estimated and names the hazard pattern it implies', () => {
    expect(weibullAssumption({ m: 5.709 }, true).summary).toMatch(/estimated.*5\.709.*rises with age/)
    expect(weibullAssumption({ m: 0.6 }, true).summary).toMatch(/falls with age/)
    expect(weibullAssumption({ m: 1 }, true).summary).toMatch(/stays constant/)
    expect(hazardPattern(Number.NaN)).toBe('unknown')
  })

  it('I-MR explains what it monitors in plain English', () => {
    expect(IMR_ASSUMPTION.summary).toMatch(/mission lengths stay steady/)
  })
})
