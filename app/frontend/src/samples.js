/** Demo payloads matching data/*.csv (see demo/README.md). */
export const SAMPLES = {
  baseline: {
    label: 'wearout_baseline',
    blurb: 'Known-answer B — expect maintain now at plan 100 h',
    times: [100, 120, 150, 200, 200],
    failed: [1, 1, 1, 0, 0],
    plan_hours: 100,
  },
  plan50: {
    label: 'baseline · plan 50 h',
    blurb: 'Same fleet, shorter horizon — expect ok to fly',
    times: [100, 120, 150, 200, 200],
    failed: [1, 1, 1, 0, 0],
    plan_hours: 50,
  },
  early: {
    label: 'early_wearout',
    blurb: 'Shorter lives — expect maintain now',
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
