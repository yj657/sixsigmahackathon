/**
 * Display text for analysis results. Pure functions only (no React, no statistics):
 * the backend decides; this file only words the result for technicians.
 */

// Same sentences the backend returns as decision_message (app/qc.py). Used for older saved
// results that were stored before decision_message existed.
export const MSG_MEETS = 'Model-estimated reliability meets the 90% threshold.'
export const MSG_BELOW =
  'Model-estimated reliability is below the 90% threshold; maintenance review is recommended.'

export const NOT_A_GUARANTEE =
  'Model estimate from the data entered — not a guarantee of flight safety.'
export const NOT_A_GUARANTEE_DETAIL =
  'These numbers come from a statistical model fitted to the flight hours you entered. They can be wrong if the data or the assumptions are wrong, and they do not certify that any drone is safe to fly. Use them alongside inspections, manufacturer limits and engineering judgement.'

const hours = (x) => (Number.isFinite(x) ? `${Number(x).toFixed(0)} flight hours` : '—')

/** True if the result meets the 90% threshold (backend field first; `call` for older saves). */
export function meetsThreshold(result) {
  if (typeof result?.meets_threshold === 'boolean') return result.meets_threshold
  return result?.call === 'ok to fly'
}

/** The banner sentence: always one of the two threshold sentences, never "ok to fly". */
export function decisionHeadline(result) {
  if (typeof result?.decision_message === 'string' && result.decision_message) {
    return result.decision_message
  }
  return meetsThreshold(result) ? MSG_MEETS : MSG_BELOW
}

/** Short label for a saved check in the History list. */
export function historyCallLabel(entry) {
  if (entry?.kind === 'imr') return entry.call || '—'
  if (!entry?.call && typeof entry?.detail?.result?.meets_threshold !== 'boolean') return '—'
  return meetsThreshold(entry.detail?.result ?? entry) ? 'Meets 90% threshold' : 'Below 90% threshold'
}

/** True if a saved History entry should be highlighted as needing attention. */
export function historyNeedsAttention(entry) {
  if (entry?.kind === 'imr') return entry.call === 'shift flagged'
  return !meetsThreshold(entry.detail?.result ?? entry)
}

/** "Based on" facts shown with every Weibull result: sample size, failures, age, plan. */
export function weibullBasis(result) {
  const age = Number.isFinite(result?.current_age) ? result.current_age : 0
  return [
    { key: 'n', label: 'Observations (drones)', value: String(result?.n ?? '—') },
    { key: 'r', label: 'Recorded failures', value: String(result?.r ?? '—') },
    { key: 'age', label: 'Drone age now', value: hours(age) },
    { key: 'plan', label: 'Planned additional flight hours', value: hours(result?.plan_hours) },
  ]
}

/** "Based on" facts shown with every I-MR result. */
export function imrBasis(result) {
  return [{ key: 'n', label: 'Missions analysed', value: String(result?.n ?? '—') }]
}

/** Hazard pattern implied by a Weibull shape m. */
export function hazardPattern(m) {
  if (!Number.isFinite(m)) return 'unknown'
  if (m > 1) return 'increasing'
  if (m < 1) return 'decreasing'
  return 'constant'
}

const PATTERN_WORDS = {
  increasing: 'failure rate rises with age (wear-out)',
  constant: 'failure rate stays constant (random failures)',
  decreasing: 'failure rate falls with age (early-life failures)',
  unknown: 'failure-rate pattern could not be determined',
}

/**
 * One-line model assumption plus a longer tooltip, for the fixed-m and free-m checks.
 * estimateM = true for the free-m (wear-pattern) check.
 */
export function weibullAssumption(result, estimateM) {
  if (!estimateM) {
    return {
      summary: 'Weibull model, shape fixed at m = 2: assumes the failure rate rises with age.',
      detail:
        'The shape is set to 2, not estimated: the model assumes the hazard (failure rate) increases with age, as for parts that wear out. Only the scale is fitted from your data. Drones still flying count as surviving at least their current hours. If your parts fail at random or early in life, use the wear-pattern check to see what the data suggest.',
    }
  }
  const pattern = hazardPattern(result?.m)
  const m = Number.isFinite(result?.m) ? Number(result.m).toFixed(3) : '—'
  return {
    summary: `Weibull model, shape estimated from your data (m̂ = ${m}): ${PATTERN_WORDS[pattern]}.`,
    detail:
      'Both the shape and the scale are estimated from your data. The fitted shape sets the hazard pattern: above 1 the failure rate rises with age (wear-out), about 1 it stays constant (random failures), below 1 it falls (early-life failures). With few failures the estimated shape is uncertain.',
  }
}

/** Plain-English explanation of what the I-MR chart monitors. */
export const IMR_ASSUMPTION = {
  summary: 'Monitors whether mission lengths stay steady from one mission to the next.',
  detail:
    'Each point on the first chart is one mission’s flight hours, in the order flown; the second chart shows how much each mission changed from the one before. Limits are worked out from the typical change between consecutive missions. A point outside the limits suggests something changed and is worth checking. It flags points only; it does not predict failures.',
}
