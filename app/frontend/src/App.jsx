import { useEffect, useId, useMemo, useRef, useState, startTransition } from 'react'
import { API_URL, analyzeFleet, checkApi, runImr } from './api.js'
import { IMR_SAMPLES, SAMPLES } from './samples.js'

const PAGES = [
  {
    id: 'fixed',
    label: 'Maintenance check (Weibull m=2)',
    blurb: 'Main decision: service now, or ok to fly? Assumes parts wear out with age.',
  },
  {
    id: 'free',
    label: 'Wear-pattern check (Free-m fit)',
    blurb: 'Same check, but the wear-out shape is estimated from your data instead of fixed.',
  },
  {
    id: 'imr',
    label: 'Mission-hours stability (I-MR chart)',
    blurb: 'Are mission lengths steady, or did something change?',
  },
]

const fmt = (x, d = 3) => (Number.isFinite(x) ? Number(x).toFixed(d) : '—')

// Display-only: the API returns reliability as a 0–1 fraction; show it as a percentage.
function fmtPct(fraction, d = 2) {
  if (!Number.isFinite(fraction)) return '—'
  const pct = fraction * 100
  if (pct > 0 && pct < 10 ** -d) return `< ${(10 ** -d).toFixed(d)}%`
  return `${pct.toFixed(d)}%`
}

// Small "i" button that explains a metric. Shows on hover or keyboard focus; click/tap pins it
// open; Escape or a click elsewhere closes it. The text is always in the DOM for screen readers.
function InfoTip({ topic, text }) {
  const id = useId()
  const wrap = useRef(null)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const shown = pinned || hovered || focused

  useEffect(() => {
    if (!pinned) return undefined
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setPinned(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [pinned])

  return (
    <span
      className="info"
      ref={wrap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="info-btn"
        aria-label={`What does “${topic}” mean?`}
        aria-describedby={id}
        aria-expanded={shown}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setPinned(false)
            setFocused(false)
            setHovered(false)
          }
        }}
      >
        i
      </button>
      <span id={id} role="tooltip" className={shown ? 'info-tip show' : 'info-tip'}>
        {text}
      </span>
    </span>
  )
}

function Stat({ label, abbr, value, unit, info }) {
  return (
    <div>
      <dt>
        {label}
        {abbr && <span className="stat-abbr"> ({abbr})</span>}
        {info && <InfoTip topic={label} text={info} />}
      </dt>
      <dd>
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </dd>
    </div>
  )
}

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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="curve"
      role="img"
      aria-label="Reliability curve: share of drones still working at each age in flight hours"
    >
      <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(0.9)} y2={y(0.9)} />
      <text className="axis" x={pad.l - 4} y={y(0.9) + 4} textAnchor="end">
        90%
      </text>
      <polyline className="series" points={points} />
      <line className="mark" x1={x(planHours)} x2={x(planHours)} y1={pad.t} y2={H - pad.b} />
      <text className="axis" x={x(planHours)} y={H - 8} textAnchor="middle">
        plan {fmt(planHours, 0)} h
      </text>
      <circle className="pt" cx={x(B10)} cy={y(0.9)} r={5}>
        <title>{`10% failure age (B10) ≈ ${fmt(B10)} flight hours`}</title>
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

function ImrSpark({ title, info, points, cl, ucl, lcl, valueKey }) {
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
      <h3 className="chart-head">
        {title}
        {info && <InfoTip topic={title} text={info} />}
      </h3>
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
            <title>{`Mission ${p.index}: ${fmt(p[valueKey], 2)} h${
              p.out_of_control ? ' — outside the limits' : ''
            }`}</title>
          </circle>
        ))}
        <text className="axis" x={pad.l - 4} y={y(ucl) + 3} textAnchor="end">
          Upper
        </text>
        <text className="axis" x={pad.l - 4} y={y(lcl) + 3} textAnchor="end">
          Lower
        </text>
      </svg>
      <p className="curve-caption">
        Center line (CL) {fmt(cl)} h · upper limit (UCL) {fmt(ucl)} h · lower limit (LCL){' '}
        {fmt(lcl)} h · points outside the limits: {points.filter((p) => p.out_of_control).length}
      </p>
    </div>
  )
}

function ApiBadge({ api }) {
  return (
    <p className={`api ${api.state}`} role="status">
      Calculation service (API) <code>{API_URL}</code>
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
            Flight hours per drone (time_hours)
            <span className="hint">
              One number per drone, separated by commas: hours at failure, or hours so far if it is
              still flying.
            </span>
          </label>
          <textarea
            id="times"
            rows={2}
            value={timesText}
            onChange={(e) => setTimesText(e.target.value)}
            spellCheck={false}
          />

          <label htmlFor="failed">
            Did it fail? (failed)
            <span className="hint">
              Same order as above: 1 = failed, 0 = still flying or removed without failing.
            </span>
          </label>
          <textarea
            id="failed"
            rows={2}
            value={failedText}
            onChange={(e) => setFailedText(e.target.value)}
            spellCheck={false}
          />

          <label htmlFor="plan">
            Planned flight hours before next service (plan_hours)
            <span className="hint">How long the fleet should fly before it is serviced, in hours.</span>
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
            {busy
              ? 'Calculating…'
              : estimateM
                ? 'Run wear-pattern check (free-m fit)'
                : 'Run maintenance check (Weibull m=2)'}
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
                ? ` Wear-out shape estimated from your data (m̂ = ${fmt(result.m, 3)}).`
                : ' Wear-out shape fixed at m = 2.'}
            </span>
          </p>

          <dl className="stats">
            <Stat
              label="Chance to complete the plan"
              abbr="reliability R"
              value={fmtPct(result.R_plan)}
              info={`Share of drones expected to fly ${fmt(result.plan_hours, 0)} hours without failing. Below 90% means service first.`}
            />
            <Stat
              label="10% failure age"
              abbr="B10 life"
              value={fmt(result.B10)}
              unit="flight hours"
              info="By this age, 1 drone in 10 is expected to have failed. Service before it."
            />
            <Stat
              label="Average life"
              abbr="MTTF, mean time to failure"
              value={fmt(result.mttf)}
              unit="flight hours"
              info="How long a drone lasts on average before it fails."
            />
            <Stat
              label="Characteristic life"
              abbr="ĉ"
              value={fmt(result.c_hat)}
              unit="flight hours"
              info="By this age, about 63% of drones are expected to have failed."
            />
            <Stat
              label="Failure rate at planned hours"
              abbr="hazard z"
              value={fmt(result.z_plan, 5)}
              unit="per flight hour"
              info={`How fast a drone that has reached ${fmt(result.plan_hours, 0)} hours is failing. Higher is riskier.`}
            />
            <Stat
              label={estimateM ? 'Wear-out shape, estimated' : 'Wear-out shape, fixed'}
              abbr={estimateM ? 'm̂' : 'm'}
              value={fmt(result.m, estimateM ? 3 : 0)}
              info={
                estimateM
                  ? 'Above 1: parts wear out with age. About 1: failures are random. Below 1: early failures.'
                  : 'Assumed, not measured: older drones are more likely to fail.'
              }
            />
            <Stat
              label="Drones / failures"
              abbr="n / r"
              value={`${result.n} / ${result.r}`}
              info="Drones in your data, and how many of them failed."
            />
          </dl>

          <h3 className="chart-head">
            Reliability curve
            <InfoTip
              topic="Reliability curve"
              text="The share of drones still working at each age, in flight hours. The horizontal line is 90%, the vertical mark is your planned hours, and the dot is the 10% failure age (B10)."
            />
          </h3>
          <ReliabilityCurve
            c={result.c_hat}
            m={result.m}
            planHours={result.plan_hours}
            B10={result.B10}
          />
          <p className="curve-caption">Line: 90% · mark: planned hours · dot: 10% failure age</p>
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
            Hours flown per mission
            <span className="hint">
              One number per mission, in the order the missions were flown, separated by commas.
            </span>
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
            {busy ? 'Calculating…' : 'Run stability check (I-MR chart)'}
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
            <Stat
              label="Unusual missions"
              abbr="out of limits, I chart"
              value={result.individuals.n_out_of_control}
              info="Missions whose hours fall outside the normal range. 0 means none."
            />
            <Stat
              label="Unusual jumps between missions"
              abbr="out of limits, MR chart"
              value={result.moving_range.n_out_of_control}
              info="Changes from one mission to the next that are bigger than normal."
            />
            <Stat
              label="Average mission length"
              abbr="x̄"
              value={fmt(result.x_bar)}
              unit="hours"
              info="The typical number of hours per mission."
            />
            <Stat
              label="Average change between missions"
              abbr="mR̄, average moving range"
              value={fmt(result.mr_bar)}
              unit="hours"
              info="How much mission length usually changes from one mission to the next."
            />
            <Stat
              label="Normal spread"
              abbr="σ̂, short-term standard deviation"
              value={fmt(result.sigma_short)}
              unit="hours"
              info="How far mission lengths normally vary around the average."
            />
            <Stat
              label="Missions"
              abbr="n"
              value={result.n}
              info="Number of missions you entered."
            />
          </dl>
          <ImrSpark
            title="Hours per mission (Individuals chart)"
            info={`Each mission's hours, in order. Red points fall outside the upper or lower limit: something may have changed and is worth checking. Only points outside the limits are flagged; no other pattern rules are applied. Limits use the standard two-point constant E₂ ≈ ${fmt(result.E2, 3)}.`}
            points={result.individuals.points}
            cl={result.individuals.cl}
            ucl={result.individuals.ucl}
            lcl={result.individuals.lcl}
            valueKey="value"
          />
          <ImrSpark
            title="Change from the previous mission (Moving-range chart)"
            info={`How much each mission's hours changed from the mission before. Red points are jumps above the upper limit, bigger than normal. The upper limit uses the standard constant D₄ = ${fmt(result.D4, 3)}; the lower limit is 0.`}
            points={result.moving_range.points}
            cl={result.moving_range.cl}
            ucl={result.moving_range.ucl}
            lcl={result.moving_range.lcl}
            valueKey="mr"
          />
          <p className="curve-caption">Red points: outside the limits, worth checking.</p>
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
            Enter each drone's flight hours and whether it failed (including drones still flying)
            to see whether the fleet should be serviced before its next block of flying. Start
            with the maintenance check; the other two pages are extra checks.
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
        Calculations in <code>app/qc.py</code> · the maintenance check assumes wear-out shape{' '}
        <em>m</em> = 2 · how to use it: <code>USER_GUIDE.md</code> · walkthrough:{' '}
        <code>demo/README.md</code>
      </footer>
    </div>
  )
}
