/** Demo payloads matching data/*.csv (see demo/README.md). */
export const SAMPLES = {
  baseline: {
    label: 'wearout_baseline',
    blurb: 'Known-answer B — expect below the 90% threshold at plan 100 h',
    times: [100, 120, 150, 200, 200],
    failed: [1, 1, 1, 0, 0],
    plan_hours: 100,
  },
  plan50: {
    label: 'baseline · plan 50 h',
    blurb: 'Same fleet, shorter horizon — expect it to meet the 90% threshold',
    times: [100, 120, 150, 200, 200],
    failed: [1, 1, 1, 0, 0],
    plan_hours: 50,
  },
  aged: {
    label: 'baseline · drone at 150 h',
    blurb: 'Same fleet, plan 50 h, but this drone has already flown 150 h — expect below the 90% threshold',
    times: [100, 120, 150, 200, 200],
    failed: [1, 1, 1, 0, 0],
    plan_hours: 50,
    current_age: 150,
  },
  early: {
    label: 'early_wearout',
    blurb: 'Shorter lives — expect below the 90% threshold (free-m ≈ 5.7)',
    times: [40, 45, 50, 55, 60, 60],
    failed: [1, 1, 1, 1, 0, 0],
    plan_hours: 100,
  },
  edge: {
    label: 'edge_all_censored',
    blurb: 'No failures — API should refuse (HTTP 400)',
    times: [80, 90, 100],
    failed: [0, 0, 0],
    plan_hours: 100,
  },
}

export const IMR_SAMPLES = {
  shift: {
    label: 'imr_mission_hours',
    blurb: 'Planted late jump — points 7–9 OOC',
    values: [10, 12, 11, 13, 12, 11, 25, 26, 24],
  },
  steady: {
    label: 'steady missions',
    blurb: 'In-control-ish hours — no planted shift',
    values: [10, 11, 10, 12, 11, 10, 11, 12, 10],
  },
}
