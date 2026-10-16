import { useEffect, useMemo, useState, startTransition } from 'react'
import { API_URL, analyzeFleet, checkApi } from './api.js'
import { SAMPLES } from './samples.js'

const fmt = (x, d = 3) => (Number.isFinite(x) ? Number(x).toFixed(d) : '—')

function parseNumberList(text) {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
  if (parts.length === 0) throw new Error('Enter at least one number.')
  const vals = parts.map((p) => {
    const n = Number(p)
    if (!Number.isFinite(n)) throw new Error(`Not a number: ${p}`)
    return n
  })
  return vals
}

function ReliabilityCurve({ c, m = 2, planHours, B10 }) {
  const W = 560
  const H = 200
  const pad = { l: 36, r: 16, t: 16, b: 28 }
  const tMax = Math.max(c * 1.4, planHours * 1.2, B10 * 1.5, 50)
  const xs = Array.from({ length: 60 }, (_, i) => (tMax * i) / 59)
  const R = (t) => Math.exp(-((t / c) ** m))
  const x = (t) => pad.l + ((W - pad.l - pad.r) * t) / tMax
  const y = (r) => pad.t + (H - pad.t - pad.b) * (1 - r)
  const points = xs.map((t) => `${x(t)},${y(R(t))}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="curve" role="img" aria-label="Reliability curve R of t">
      <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(0.9)} y2={y(0.9)} />
      <text className="axis" x={pad.l - 4} y={y(0.9) + 4} textAnchor="end">
        0.9
      </text>
      <polyline className="series" points={points} />
      <line className="mark" x1={x(planHours)} x2={x(planHours)} y1={pad.t} y2={H - pad.b} />
      <text className="axis" x={x(planHours)} y={H - 8} textAnchor="middle">
        plan {fmt(planHours, 0)} h
      </text>
      <circle className="pt" cx={x(B10)} cy={y(0.9)} r={5}>
        <title>{`B10 ≈ ${fmt(B10)} h`}</title>
      </circle>
      <text className="axis" x={pad.l} y={H - 8}>
        0 h
      </text>
      <text className="axis" x={W - pad.r} y={H - 8} textAnchor="end">
        {fmt(tMax, 0)} h
      </text>
    </svg>
  )
}

export default function App() {
  const [timesText, setTimesText] = useState(SAMPLES.baseline.times.join(', '))
  const [failedText, setFailedText] = useState(SAMPLES.baseline.failed.join(', '))
  const [planHours, setPlanHours] = useState(100)
  const [api, setApi] = useState({ state: 'checking' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    checkApi()
      .then((r) => setApi({ state: 'ok', message: r.message || 'ok' }))
      .catch(() => setApi({ state: 'down' }))
  }, [])

  function loadSample(key) {
    const s = SAMPLES[key]
    startTransition(() => {
      setTimesText(s.times.join(', '))
      setFailedText(s.failed.join(', '))
      setPlanHours(s.plan_hours)
      setError(null)
      setResult(null)
    })
  }

  async function onAnalyze(e) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const times = parseNumberList(timesText)
      const failed = parseNumberList(failedText).map((n) => Math.trunc(n))
      if (times.length !== failed.length) {
        throw new Error('times and failed must have the same length.')
      }
      const out = await analyzeFleet({
        times,
        failed,
        plan_hours: Number(planHours) || 100,
        m: 2,
      })
      setResult(out)
    } catch (err) {
      setResult(null)
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const callClass = useMemo(() => {
    if (!result) return ''
    return result.call === 'maintain now' ? 'call danger' : 'call safe'
  }, [result])

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="brand">kskbl</p>
          <h1>Fleet reliability desk</h1>
          <p className="lede">
            Log flight hours and failures (including drones still flying). Weibull wear-out
            (<em>m</em> = 2) returns MTTF, R(t), B10, and a maintain-now call before the next
            mission.
          </p>
        </div>
        <p className={`api ${api.state}`} role="status">
          API <code>{API_URL}</code>
          <br />
          {api.state === 'checking' && 'checking…'}
          {api.state === 'ok' && 'connected'}
          {api.state === 'down' && 'unreachable — start the API or check VITE_API_URL'}
        </p>
      </header>

      <div className="samples" role="group" aria-label="Load a demo dataset">
        {Object.entries(SAMPLES).map(([key, s]) => (
          <button key={key} type="button" className="chip" onClick={() => loadSample(key)}>
            <span className="chip-label">{s.label}</span>
            <span className="chip-blurb">{s.blurb}</span>
          </button>
        ))}
      </div>

      <form className="panel" onSubmit={onAnalyze}>
        <div className="fields">
          <label htmlFor="times">
            time_hours
            <span className="hint">comma-separated flight hours</span>
          </label>
          <textarea
            id="times"
            rows={2}
            value={timesText}
            onChange={(e) => setTimesText(e.target.value)}
            spellCheck={false}
          />

          <label htmlFor="failed">
            failed
            <span className="hint">1 = failed, 0 = still flying (censored)</span>
          </label>
          <textarea
            id="failed"
            rows={2}
            value={failedText}
            onChange={(e) => setFailedText(e.target.value)}
            spellCheck={false}
          />

          <label htmlFor="plan">
            plan_hours
            <span className="hint">next-mission horizon</span>
          </label>
          <input
            id="plan"
            type="number"
            min={1}
            step={1}
            value={planHours}
            onChange={(e) => setPlanHours(e.target.value)}
          />
        </div>

        <div className="actions">
          <button type="submit" className="primary" disabled={busy || api.state === 'down'}>
            {busy ? 'Fitting…' : 'Run Weibull fit'}
          </button>
          <a className="ghost" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            Open API docs
          </a>
        </div>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="result" aria-live="polite">
          <p className={callClass}>
            <strong>{result.call}</strong>
            <span>
              {result.call === 'maintain now'
                ? 'Ground and service before the next mission.'
                : 'Reliability for this plan horizon looks acceptable.'}
            </span>
          </p>

          <dl className="stats">
            <div>
              <dt>ĉ (hours)</dt>
              <dd>{fmt(result.c_hat)}</dd>
            </div>
            <div>
              <dt>MTTF</dt>
              <dd>{fmt(result.mttf)}</dd>
            </div>
            <div>
              <dt>R(plan)</dt>
              <dd>{fmt(result.R_plan, 4)}</dd>
            </div>
            <div>
              <dt>z(plan)</dt>
              <dd>{fmt(result.z_plan, 5)}</dd>
            </div>
            <div>
              <dt>B10</dt>
              <dd>{fmt(result.B10)}</dd>
            </div>
            <div>
              <dt>n / r</dt>
              <dd>
                {result.n} / {result.r}
              </dd>
            </div>
          </dl>

          <ReliabilityCurve
            c={result.c_hat}
            m={result.m}
            planHours={result.plan_hours}
            B10={result.B10}
          />
          <p className="curve-caption">
            Reliability R(t). Vertical mark = plan horizon; dot ≈ B10 (10% failed).
          </p>
        </section>
      )}

      <footer>
        Statistics in <code>app/qc.py</code> · shape <em>m</em> = 2 fixed · walkthrough in{' '}
        <code>demo/README.md</code>
      </footer>
    </div>
  )
}
