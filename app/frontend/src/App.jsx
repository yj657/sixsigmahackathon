import { useEffect, useMemo, useState, startTransition } from 'react'
import { API_URL, analyzeFleet, checkApi, runImr } from './api.js'
import { IMR_SAMPLES, SAMPLES } from './samples.js'

const PAGES = [
  { id: 'fixed', label: 'Weibull m=2', blurb: 'Primary maintain-now path' },
  { id: 'free', label: 'Free-m fit', blurb: 'Estimate shape from data' },
  { id: 'imr', label: 'I-MR chart', blurb: 'Mission-hour process' },
]

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

function ImrSpark({ title, points, cl, ucl, lcl, valueKey }) {
  const W = 560
  const H = 160
  const pad = { l: 40, r: 16, t: 14, b: 24 }
  const vals = points.map((p) => p[valueKey])
  const ymin = Math.min(lcl, ...vals) - 1
  const ymax = Math.max(ucl, ...vals) + 1
  const span = ymax - ymin || 1
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(points.length - 1, 1)
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - ymin) / span)
  const series = points.map((p, i) => `${x(i)},${y(p[valueKey])}`).join(' ')

  return (
    <div className="imr-block">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="curve" role="img" aria-label={title}>
        <line className="limit" x1={pad.l} x2={W - pad.r} y1={y(ucl)} y2={y(ucl)} />
        <line className="limit mid" x1={pad.l} x2={W - pad.r} y1={y(cl)} y2={y(cl)} />
        <line className="limit" x1={pad.l} x2={W - pad.r} y1={y(lcl)} y2={y(lcl)} />
        <polyline className="series" points={series} />
        {points.map((p, i) => (
          <circle
            key={p.index}
            className={p.out_of_control ? 'pt' : 'pt ok'}
            cx={x(i)}
            cy={y(p[valueKey])}
            r={4}
          >
            <title>{`${p.index}: ${fmt(p[valueKey], 2)}${p.out_of_control ? ' OOC' : ''}`}</title>
          </circle>
        ))}
        <text className="axis" x={pad.l - 4} y={y(ucl) + 3} textAnchor="end">
          UCL
        </text>
        <text className="axis" x={pad.l - 4} y={y(lcl) + 3} textAnchor="end">
          LCL
        </text>
      </svg>
      <p className="curve-caption">
        CL {fmt(cl)} · UCL {fmt(ucl)} · LCL {fmt(lcl)} · OOC{' '}
        {points.filter((p) => p.out_of_control).length}
      </p>
    </div>
  )
}

function ApiBadge({ api }) {
  return (
    <p className={`api ${api.state}`} role="status">
      API <code>{API_URL}</code>
      <br />
      {api.state === 'checking' && 'checking…'}
      {api.state === 'ok' && 'connected'}
      {api.state === 'down' && 'unreachable — start the API or check VITE_API_URL'}
    </p>
  )
}

function WeibullPage({ estimateM, api }) {
  const initial = estimateM ? SAMPLES.early : SAMPLES.baseline
  const [timesText, setTimesText] = useState(initial.times.join(', '))
  const [failedText, setFailedText] = useState(initial.failed.join(', '))
  const [planHours, setPlanHours] = useState(initial.plan_hours)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

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
        estimate_m: estimateM,
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
    <>
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
            {busy ? 'Fitting…' : estimateM ? 'Run free-m MLE' : 'Run Weibull fit (m=2)'}
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
              {estimateM
                ? ` Shape estimated from data (m̂ = ${fmt(result.m, 3)}).`
                : ' Shape fixed at m = 2.'}
            </span>
          </p>

          <dl className="stats">
            <div>
              <dt>{estimateM ? 'm̂' : 'm (fixed)'}</dt>
              <dd>{fmt(result.m, estimateM ? 3 : 0)}</dd>
            </div>
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
    </>
  )
}

function ImrPage({ api }) {
  const [valuesText, setValuesText] = useState(IMR_SAMPLES.shift.values.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  function loadSample(key) {
    const s = IMR_SAMPLES[key]
    startTransition(() => {
      setValuesText(s.values.join(', '))
      setError(null)
      setResult(null)
    })
  }

  async function onRun(e) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const values = parseNumberList(valuesText)
      const out = await runImr({ values })
      setResult(out)
    } catch (err) {
      setResult(null)
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="samples" role="group" aria-label="Load an I-MR sample">
        {Object.entries(IMR_SAMPLES).map(([key, s]) => (
          <button key={key} type="button" className="chip" onClick={() => loadSample(key)}>
            <span className="chip-label">{s.label}</span>
            <span className="chip-blurb">{s.blurb}</span>
          </button>
        ))}
      </div>

      <form className="panel" onSubmit={onRun}>
        <div className="fields">
          <label htmlFor="values">
            mission hours
            <span className="hint">ordered series, one value per mission</span>
          </label>
          <textarea
            id="values"
            rows={2}
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || api.state === 'down'}>
            {busy ? 'Computing…' : 'Run I-MR chart'}
          </button>
        </div>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="result" aria-live="polite">
          <dl className="stats">
            <div>
              <dt>x̄</dt>
              <dd>{fmt(result.x_bar)}</dd>
            </div>
            <div>
              <dt>mR̄</dt>
              <dd>{fmt(result.mr_bar)}</dd>
            </div>
            <div>
              <dt>σ̂ short</dt>
              <dd>{fmt(result.sigma_short)}</dd>
            </div>
            <div>
              <dt>I OOC</dt>
              <dd>{result.individuals.n_out_of_control}</dd>
            </div>
            <div>
              <dt>MR OOC</dt>
              <dd>{result.moving_range.n_out_of_control}</dd>
            </div>
            <div>
              <dt>n</dt>
              <dd>{result.n}</dd>
            </div>
          </dl>
          <ImrSpark
            title="Individuals"
            points={result.individuals.points}
            cl={result.individuals.cl}
            ucl={result.individuals.ucl}
            lcl={result.individuals.lcl}
            valueKey="value"
          />
          <ImrSpark
            title="Moving range"
            points={result.moving_range.points}
            cl={result.moving_range.cl}
            ucl={result.moving_range.ucl}
            lcl={result.moving_range.lcl}
            valueKey="mr"
          />
          <p className="curve-caption">
            Limits use span-2 constants (E₂≈{fmt(result.E2, 3)}, D₄={fmt(result.D4, 3)}). Red
            points are beyond the limits only — no Western Electric run rules.
          </p>
        </section>
      )}
    </>
  )
}

export default function App() {
  const [page, setPage] = useState('fixed')
  const [api, setApi] = useState({ state: 'checking' })

  useEffect(() => {
    checkApi()
      .then((r) => setApi({ state: 'ok', message: r.message || 'ok' }))
      .catch(() => setApi({ state: 'down' }))
  }, [])

  const active = PAGES.find((p) => p.id === page) || PAGES[0]

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="brand">kskbl</p>
          <h1>Fleet reliability desk</h1>
          <p className="lede">
            Log flight hours and failures (including drones still flying). Primary path: Weibull
            wear-out (<em>m</em> = 2). Secondary: free-<em>m</em> MLE and I-MR on mission hours.
          </p>
        </div>
        <ApiBadge api={api} />
      </header>

      <nav className="tabs" aria-label="Analysis pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={page === p.id ? 'tab active' : 'tab'}
            onClick={() => setPage(p.id)}
            aria-current={page === p.id ? 'page' : undefined}
          >
            <span className="tab-label">{p.label}</span>
            <span className="tab-blurb">{p.blurb}</span>
          </button>
        ))}
      </nav>

      <p className="page-note">{active.blurb}</p>

      {page === 'fixed' && <WeibullPage estimateM={false} api={api} />}
      {page === 'free' && <WeibullPage estimateM={true} api={api} />}
      {page === 'imr' && <ImrPage api={api} />}

      <footer>
        Statistics in <code>app/qc.py</code> · primary shape <em>m</em> = 2 · free-<em>m</em> +
        I-MR in H-09 · walkthrough in <code>demo/README.md</code>
      </footer>
    </div>
  )
}
