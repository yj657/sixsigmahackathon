import { useEffect, useId, useMemo, useRef, useState, startTransition } from 'react'
import { API_URL, analyzeFleet, checkApi, runImr } from './api.js'
import { appendHistory, clearHistory, loadHistory } from './history.js'
import { IMR_SAMPLES, SAMPLES } from './samples.js'

/** Top-level site pages (separate screens). */
const NAV = [
  { id: 'check', label: 'Check' },
  { id: 'history', label: 'History' },
  { id: 'help', label: 'Help' },
  { id: 'api', label: 'API docs' },
  { id: 'contributor', label: 'Contributor' },
]

/** Checks available on the Check page only. */
const CHECKS = [
  {
    id: 'fixed',
    label: 'Should we service now?',
    short: 'Start here',
    blurb:
      'Main tool for technicians: enter flight hours and failures, get maintain now or ok to fly. Assumes parts wear out with age (shape m = 2).',
  },
  {
    id: 'free',
    label: 'How sharp is the wear-out?',
    short: 'Optional',
    blurb:
      'Same decision, but estimates how steeply risk rises with age from your data. Useful when you want a second opinion on the wear pattern.',
  },
  {
    id: 'imr',
    label: 'Are mission hours steady?',
    short: 'Optional',
    blurb:
      'Not a life model — checks whether consecutive mission lengths jumped. Red points mean something changed and is worth looking at.',
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

// A form label with its explanation behind an info icon (kept outside <label> so the icon is
// its own control).
function FieldLabel({ htmlFor, children, topic, info }) {
  return (
    <div className="field-head">
      <label htmlFor={htmlFor}>{children}</label>
      <InfoTip topic={topic} text={info} />
    </div>
  )
}

// Sample buttons show only the sample name; the description is behind an info icon.
function SampleChips({ samples, onLoad, ariaLabel }) {
  return (
    <div className="samples" role="group" aria-label={ariaLabel}>
      {Object.entries(samples).map(([key, s]) => (
        <div key={key} className="chip-wrap">
          <button type="button" className="chip" onClick={() => onLoad(key)}>
            <span className="chip-label">{s.label}</span>
          </button>
          <InfoTip topic={`${s.label} sample`} text={s.blurb} />
        </div>
      ))}
    </div>
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
  const host = API_URL.replace(/^https?:\/\//, '')
  const hostShown = host.length > 44 ? `${host.slice(0, 42)}…` : host
  return (
    <p className={`api ${api.state}`} role="status">
      <span className="api-label">Calculator status</span>
      {api.state === 'checking' && <span className="api-state">checking…</span>}
      {api.state === 'ok' && <span className="api-state ok-text">Ready</span>}
      {api.state === 'down' && (
        <span className="api-state down-text">Offline — ask your team to start the API</span>
      )}
      <code className="api-url" title={API_URL}>
        {hostShown}
      </code>
    </p>
  )
}

/** Results open in a modal panel (popup window) so the form stays clean. */
function ResultModal({ open, title, onClose, children }) {
  const titleId = useId()
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus close after paint so keyboard users land in the dialog.
    const t = window.setTimeout(() => closeRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      window.clearTimeout(t)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={() => {}}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close results"
          >
            Close
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
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
  const [modalOpen, setModalOpen] = useState(false)

  function loadSample(key) {
    const s = SAMPLES[key]
    startTransition(() => {
      setTimesText(s.times.join(', '))
      setFailedText(s.failed.join(', '))
      setPlanHours(s.plan_hours)
      setError(null)
      setResult(null)
      setModalOpen(false)
    })
  }

  async function onAnalyze(e) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    setModalOpen(false)
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
      appendHistory({
        kind: estimateM ? 'free-m' : 'weibull-m2',
        title: estimateM ? 'How sharp is the wear-out?' : 'Should we service now?',
        summary: `ĉ ${fmt(out.c_hat)} h · chance ${fmtPct(out.R_plan)} · plan ${fmt(out.plan_hours, 0)} h`,
        call: out.call,
        detail: {
          times,
          failed,
          plan_hours: out.plan_hours,
          result: out,
        },
      })
      setResult(out)
      setModalOpen(true)
    } catch (err) {
      setResult(null)
      setModalOpen(false)
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
      <p className="section-label">Try a ready-made example, or type your own numbers below</p>
      <SampleChips samples={SAMPLES} onLoad={loadSample} ariaLabel="Load a demo dataset" />

      {error && (
        <p className="error error-banner" role="alert">
          <span className="error-label">Could not run</span>
          {error}
        </p>
      )}

      <form className="panel" onSubmit={onAnalyze}>
        <div className="fields">
          <FieldLabel
            htmlFor="times"
            topic="Flight hours per drone"
            info="One number per drone, separated by commas: hours at failure, or hours so far if it is still flying."
          >
            Flight hours per drone (time_hours)
          </FieldLabel>
          <textarea
            id="times"
            rows={2}
            value={timesText}
            onChange={(e) => setTimesText(e.target.value)}
            spellCheck={false}
          />

          <FieldLabel
            htmlFor="failed"
            topic="Did it fail?"
            info="Same order as above: 1 = failed, 0 = still flying or removed without failing."
          >
            Did it fail? (failed)
          </FieldLabel>
          <textarea
            id="failed"
            rows={2}
            value={failedText}
            onChange={(e) => setFailedText(e.target.value)}
            spellCheck={false}
          />

          <FieldLabel
            htmlFor="plan"
            topic="Planned flight hours before next service"
            info="How long the fleet should fly before it is serviced, in hours."
          >
            Planned flight hours before next service (plan_hours)
          </FieldLabel>
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
        </div>
      </form>

      <ResultModal
        open={modalOpen && !!result}
        title={estimateM ? 'Wear-pattern check results' : 'Maintenance check results'}
        onClose={() => setModalOpen(false)}
      >
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
          </section>
        )}
      </ResultModal>
    </>
  )
}

function ImrPage({ api }) {
  const [valuesText, setValuesText] = useState(IMR_SAMPLES.shift.values.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  function loadSample(key) {
    const s = IMR_SAMPLES[key]
    startTransition(() => {
      setValuesText(s.values.join(', '))
      setError(null)
      setResult(null)
      setModalOpen(false)
    })
  }

  async function onRun(e) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    setModalOpen(false)
    try {
      const values = parseNumberList(valuesText)
      const out = await runImr({ values })
      const iOoc = out.individuals.n_out_of_control
      const mrOoc = out.moving_range.n_out_of_control
      appendHistory({
        kind: 'imr',
        title: 'Are mission hours steady?',
        summary: `unusual missions ${iOoc} · unusual jumps ${mrOoc} · n=${out.n}`,
        call: iOoc + mrOoc > 0 ? 'shift flagged' : 'looks steady',
        detail: { values, result: out },
      })
      setResult(out)
      setModalOpen(true)
    } catch (err) {
      setResult(null)
      setModalOpen(false)
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="section-label">Try a ready-made example, or type your own mission hours below</p>
      <SampleChips samples={IMR_SAMPLES} onLoad={loadSample} ariaLabel="Load an I-MR sample" />

      {error && (
        <p className="error error-banner" role="alert">
          <span className="error-label">Could not run</span>
          {error}
        </p>
      )}

      <form className="panel" onSubmit={onRun}>
        <div className="fields">
          <FieldLabel
            htmlFor="values"
            topic="Hours flown per mission"
            info="One number per mission, in the order the missions were flown, separated by commas."
          >
            Hours flown per mission
          </FieldLabel>
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

      <ResultModal
        open={modalOpen && !!result}
        title="Mission-hours stability results"
        onClose={() => setModalOpen(false)}
      >
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
          </section>
        )}
      </ResultModal>
    </>
  )
}

function ManualPage({ onOpenCheck, onOpenApi, apiReady }) {
  return (
    <article className="manual">
      <header className="page-hero">
        <h1>Help · User manual</h1>
        <p className="lede">
          Step-by-step guide for fleet maintenance technicians. For HTTP endpoints, use the{' '}
          <button type="button" className="footer-link" onClick={onOpenApi}>
            API docs
          </button>{' '}
          page.
        </p>
      </header>

      <section className="manual-block">
        <h3>Who this is for</h3>
        <p>
          You are a <strong>fleet maintenance technician</strong> at a drone delivery startup. After
          logging flight hours — including drones still in the air — you need a clear call before
          the next missions: <strong>maintain now</strong> (ground and service) or{' '}
          <strong>ok to fly</strong>.
        </p>
        <p className="manual-note">
          Calculator status right now: <strong>{apiReady ? 'Ready' : 'Offline'}</strong>.
        </p>
      </section>

      <section className="manual-block">
        <h3>Quick start (about 1 minute)</h3>
        <ol className="manual-steps">
          <li>
            Open the top menu <strong>Check</strong>, then the tool <strong>Should we service
            now?</strong> (Start here).
          </li>
          <li>
            Click the sample <strong>wearout_baseline</strong> — it fills the form for you.
          </li>
          <li>
            Press <strong>Run</strong>. A results window pops up.
          </li>
          <li>
            Read the banner: for that sample you should see <strong>maintain now</strong> and
            characteristic life ≈ <strong>205.7</strong> flight hours.
          </li>
        </ol>
        <button type="button" className="primary" onClick={() => onOpenCheck('fixed')}>
          Open Check · Should we service now?
        </button>
      </section>

      <section className="manual-block">
        <h3>What to type in</h3>
        <table className="manual-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>What it means on the shop floor</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Flight hours per drone</td>
              <td>
                One number per airframe, comma-separated. Hours at failure, or hours so far if still
                flying. Must be &gt; 0.
              </td>
            </tr>
            <tr>
              <td>Did it fail?</td>
              <td>
                Same order: <code>1</code> = failed / grounded as failed, <code>0</code> = still
                flying or removed without failing. Only 0 or 1.
              </td>
            </tr>
            <tr>
              <td>Planned flight hours</td>
              <td>
                How long until the next planned service window (default 100). Shorter plans are
                easier to clear as ok to fly.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Do not drop still-flying drones.</strong> They count as “survived at least this
          long.” Leaving them out makes the fleet look worse than it is.
        </p>
      </section>

      <section className="manual-block">
        <h3>How to read the popup</h3>
        <ul className="manual-list">
          <li>
            <strong>maintain now</strong> — B10 life is at or below your plan, or fewer than 90% of
            drones are expected to finish the plan. Service before dispatch.
          </li>
          <li>
            <strong>ok to fly</strong> — the plan looks acceptable under the same rule.
          </li>
          <li>
            <strong>Chance to complete the plan</strong> — reliability as a percentage. Below 90% →
            service first.
          </li>
          <li>
            <strong>10% failure age (B10)</strong> — age when 1 in 10 drones is expected to have
            failed.
          </li>
          <li>
            Hover or tap the small <strong>i</strong> icons for short definitions of each number.
          </li>
          <li>
            Close the window with <strong>Close</strong>, the dark background, or Escape. Open the{' '}
            <strong>History</strong> page anytime to review past runs.
          </li>
        </ul>
      </section>

      <section className="manual-block">
        <h3>Practice with the samples</h3>
        <table className="manual-table">
          <thead>
            <tr>
              <th>Sample</th>
              <th>What you should see</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>wearout_baseline · plan 100</td>
              <td>
                ĉ ≈ 205.7 h → <strong>maintain now</strong>
              </td>
            </tr>
            <tr>
              <td>baseline · plan 50 h</td>
              <td>
                Same fleet, shorter plan → <strong>ok to fly</strong>
              </td>
            </tr>
            <tr>
              <td>early_wearout</td>
              <td>
                Short lives → <strong>maintain now</strong> (harsh wear)
              </td>
            </tr>
            <tr>
              <td>edge_all_censored</td>
              <td>
                No failures yet → red error, <em>no</em> invented numbers
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="manual-block">
        <h3>The other two checks (optional)</h3>
        <div className="manual-actions">
          <button type="button" className="ghost-btn" onClick={() => onOpenCheck('free')}>
            How sharp is the wear-out?
          </button>
          <button type="button" className="ghost-btn" onClick={() => onOpenCheck('imr')}>
            Are mission hours steady?
          </button>
        </div>
        <ul className="manual-list">
          <li>
            <strong>Wear-out shape</strong> — estimates how steeply risk rises with age (needs at
            least two failures). Use as a second opinion; the main call still starts with m = 2.
          </li>
          <li>
            <strong>Mission hours</strong> — enter consecutive mission lengths. Red points on the
            charts are outside normal limits (something may have changed).
          </li>
        </ul>
      </section>

      <section className="manual-block">
        <h3>If something looks wrong</h3>
        <ul className="manual-list">
          <li>
            Calculator status <strong>Offline</strong> — Run is disabled; wait or ask a teammate to
            start the API.
          </li>
          <li>
            Red error under the form — fix the message (blank cells, failed not 0/1, mismatched
            list lengths, zero failures).
          </li>
          <li>
            Popup blocked? Results open as an in-page window, not a browser tab — allow the dark
            overlay; no popup-blocker setting needed.
          </li>
        </ul>
      </section>
    </article>
  )
}

function ApiDocsPage() {
  const endpoints = [
    {
      method: 'POST',
      path: '/analyze',
      note: 'Weibull fit. Body: times, failed, optional plan_hours, m, estimate_m. Use this on Connect.',
    },
    {
      method: 'GET',
      path: '/analyze/file',
      note: 'Same analysis from a CSV in data/ — local only (data/ is not deployed).',
    },
    {
      method: 'POST',
      path: '/imr',
      note: 'I-MR chart. Body: values (ordered mission hours).',
    },
    {
      method: 'GET',
      path: '/imr/file',
      note: 'I-MR from a CSV in data/ — local only.',
    },
    {
      method: 'GET',
      path: '/docs',
      note: 'Interactive OpenAPI / Swagger UI (try requests in the browser).',
    },
  ]

  return (
    <article className="manual">
      <header className="page-hero">
        <h1>API docs</h1>
        <p className="lede">
          For developers and judges who want to call the calculator over HTTP. Technicians can stay
          on <strong>Check</strong> and never open this page.
        </p>
      </header>

      <section className="manual-block">
        <h3>Live OpenAPI</h3>
        <p>
          Full interactive docs (schemas, Try it out) are hosted with the FastAPI app:
        </p>
        <p>
          <a className="primary-link" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            Open live API docs →
          </a>
        </p>
        <p className="manual-note">
          Base URL: <code>{API_URL}</code>
        </p>
      </section>

      <section className="manual-block">
        <h3>Endpoints at a glance</h3>
        <table className="manual-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.path + ep.method}>
                <td>
                  <code>{ep.method}</code>
                </td>
                <td>
                  <code>{ep.path}</code>
                </td>
                <td>{ep.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="manual-block">
        <h3>Example (live)</h3>
        <pre className="manual-code">{`curl -X POST "${API_URL}/analyze" \\
  -H "Content-Type: application/json" \\
  -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":100}'`}</pre>
        <p className="manual-note">Expect c_hat ≈ 205.670 and call &quot;maintain now&quot;.</p>
      </section>
    </article>
  )
}

const CONTRIBUTORS = [
  {
    id: 'percy',
    name: 'Percy Qian',
    role: 'Statistics, API, deploy, UI',
    // Relative path: Connect serves under /content/<guid>/, so "/contributors/..." 404s.
    photo: './contributors/percy.jpg',
    initials: 'PQ',
  },
  {
    id: 'yijia',
    name: 'Yijia Jiang',
    role: 'Data, demo walkthrough, documentation',
    photo: null,
    initials: 'YJ',
  },
  {
    id: 'yang',
    name: 'Yang',
    role: '',
    photo: null,
    initials: 'Y',
  },
]

function ContributorCard({ person }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const showPhoto = person.photo && !photoFailed

  return (
    <article className="person-card">
      <div className="person-photo-wrap">
        {showPhoto ? (
          <img
            className="person-photo"
            src={person.photo}
            alt={`${person.name}, team kskbl`}
            width={280}
            height={280}
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <div className="person-photo person-photo-fallback" aria-hidden="true">
            {person.initials}
          </div>
        )}
      </div>
      <h3 className="person-name">{person.name}</h3>
      {person.role ? (
        <p className="person-role">{person.role}</p>
      ) : (
        <p className="person-role person-role-empty">Contribution forthcoming</p>
      )}
    </article>
  )
}

function ContributorPage({ onOpenHelp }) {
  return (
    <article className="manual">
      <header className="page-hero">
        <h1>Contributor</h1>
        <p className="lede">
          Team <strong>kskbl</strong> — Cornell Six Sigma Hackathon (on-campus), Prompt 4: Drone
          Delivery Fleet Maintenance.
        </p>
      </header>

      <section className="manual-block">
        <h3>Who built this</h3>
        <div className="person-grid" role="list">
          {CONTRIBUTORS.map((person) => (
            <div key={person.id} role="listitem">
              <ContributorCard person={person} />
            </div>
          ))}
        </div>
        <p>
          Public repo:{' '}
          <a href="https://github.com/yj657/sixsigmahackathon" target="_blank" rel="noreferrer">
            github.com/yj657/sixsigmahackathon
          </a>{' '}
          (branch <code>kskbl</code>).
        </p>
      </section>

      <section className="manual-block">
        <h3>How the code is split</h3>
        <ul className="manual-list">
          <li>
            <code>app/qc.py</code> — all statistics (Weibull + I-MR)
          </li>
          <li>
            <code>app/app.py</code> — FastAPI only (parse input → call qc → JSON)
          </li>
          <li>
            <code>app/frontend/</code> — this React desk
          </li>
          <li>
            <code>tests/</code> — known-answer and edge-case tests
          </li>
          <li>
            <code>data/</code> — invented field-shaped CSVs + codebook
          </li>
        </ul>
      </section>

      <section className="manual-block">
        <h3>Want to extend it?</h3>
        <ol className="manual-steps">
          <li>
            Clone the repo, checkout <code>kskbl</code>, create a venv,{' '}
            <code>pip install -r app/requirements.txt</code>, run <code>pytest tests</code>.
          </li>
          <li>
            Change formulas only in <code>app/qc.py</code>, with a test for a known answer first.
          </li>
          <li>
            Keep secrets out of git (Connect keys live in GitHub Actions secrets / local{' '}
            <code>.env</code>).
          </li>
        </ol>
        <p className="manual-note">
          Shop-floor how-to stays on the{' '}
          <button type="button" className="footer-link" onClick={onOpenHelp}>
            Help
          </button>{' '}
          page — keep contributor notes technical.
        </p>
      </section>

      <section className="manual-block">
        <h3>Credits</h3>
        <p>
          Starter from the{' '}
          <a
            href="https://github.com/timothyfraser/sixsigmahackathon"
            target="_blank"
            rel="noreferrer"
          >
            Cornell Six Sigma Hackathon repo
          </a>{' '}
          (MIT). Weibull / I-MR formulas follow SYSEN 5300.
        </p>
      </section>
    </article>
  )
}

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function HistoryPage() {
  const [entries, setEntries] = useState(() => loadHistory())
  const [selected, setSelected] = useState(null)

  function refresh() {
    setEntries(loadHistory())
  }

  function onClear() {
    if (!window.confirm('Clear all check history on this browser?')) return
    clearHistory()
    setSelected(null)
    setEntries([])
  }

  const selectedResult = selected?.detail?.result

  return (
    <article className="manual">
      <header className="page-hero">
        <h1>Check history</h1>
        <p className="lede">
          Predictions from this browser are saved automatically after each successful Run. Nothing is
          uploaded to a server — clearing the browser data clears this list.
        </p>
      </header>

      <section className="manual-block">
        <div className="history-toolbar">
          <button type="button" className="ghost-btn" onClick={refresh}>
            Refresh
          </button>
          <button type="button" className="ghost-btn" onClick={onClear} disabled={entries.length === 0}>
            Clear history
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="manual-note">
            No checks yet. Run a Check (service now, wear-out, or mission hours), then come back
            here.
          </p>
        ) : (
          <ul className="history-list">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={selected?.id === e.id ? 'history-row active' : 'history-row'}
                  onClick={() => setSelected(e)}
                >
                  <span className="history-when">{formatWhen(e.at)}</span>
                  <span className="history-title">{e.title}</span>
                  <span
                    className={
                      e.call === 'maintain now' || e.call === 'shift flagged'
                        ? 'history-call danger'
                        : 'history-call safe'
                    }
                  >
                    {e.call || '—'}
                  </span>
                  <span className="history-summary">{e.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ResultModal
        open={!!selected && !!selectedResult}
        title={selected ? `Saved · ${selected.title}` : 'Saved result'}
        onClose={() => setSelected(null)}
      >
        {selected && selectedResult && selected.kind !== 'imr' && (
          <section className="result">
            <p
              className={
                selectedResult.call === 'maintain now' ? 'call danger' : 'call safe'
              }
            >
              <strong>{selectedResult.call}</strong>
              <span>
                {selectedResult.call === 'maintain now'
                  ? 'Ground and service before the next mission.'
                  : 'Reliability for this plan horizon looks acceptable.'}
                {selected.kind === 'free-m'
                  ? ` Wear-out shape estimated from your data (m̂ = ${fmt(selectedResult.m, 3)}).`
                  : ' Wear-out shape fixed at m = 2.'}
              </span>
            </p>
            <dl className="stats">
              <Stat
                label="Chance to complete the plan"
                abbr="reliability R"
                value={fmtPct(selectedResult.R_plan)}
                info={`Share of drones expected to fly ${fmt(selectedResult.plan_hours, 0)} hours without failing. Below 90% means service first.`}
              />
              <Stat
                label="10% failure age"
                abbr="B10 life"
                value={fmt(selectedResult.B10)}
                unit="flight hours"
                info="By this age, 1 drone in 10 is expected to have failed. Service before it."
              />
              <Stat
                label="Average life"
                abbr="MTTF, mean time to failure"
                value={fmt(selectedResult.mttf)}
                unit="flight hours"
                info="How long a drone lasts on average before it fails."
              />
              <Stat
                label="Characteristic life"
                abbr="ĉ"
                value={fmt(selectedResult.c_hat)}
                unit="flight hours"
                info="By this age, about 63% of drones are expected to have failed."
              />
              <Stat
                label="Failure rate at planned hours"
                abbr="hazard z"
                value={fmt(selectedResult.z_plan, 5)}
                unit="per flight hour"
                info={`How fast a drone that has reached ${fmt(selectedResult.plan_hours, 0)} hours is failing. Higher is riskier.`}
              />
              <Stat
                label={
                  selected.kind === 'free-m'
                    ? 'Wear-out shape, estimated'
                    : 'Wear-out shape, fixed'
                }
                abbr={selected.kind === 'free-m' ? 'm̂' : 'm'}
                value={fmt(selectedResult.m, selected.kind === 'free-m' ? 3 : 0)}
                info={
                  selected.kind === 'free-m'
                    ? 'Above 1: parts wear out with age. About 1: failures are random. Below 1: early failures.'
                    : 'Assumed, not measured: older drones are more likely to fail.'
                }
              />
              <Stat
                label="Drones / failures"
                abbr="n / r"
                value={`${selectedResult.n} / ${selectedResult.r}`}
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
              c={selectedResult.c_hat}
              m={selectedResult.m}
              planHours={selectedResult.plan_hours}
              B10={selectedResult.B10}
            />
          </section>
        )}
        {selected && selectedResult && selected.kind === 'imr' && (
          <section className="result">
            <dl className="stats">
              <Stat
                label="Unusual missions"
                abbr="out of limits, I chart"
                value={selectedResult.individuals.n_out_of_control}
                info="Missions whose hours fall outside the normal range. 0 means none."
              />
              <Stat
                label="Unusual jumps between missions"
                abbr="out of limits, MR chart"
                value={selectedResult.moving_range.n_out_of_control}
                info="Changes from one mission to the next that are bigger than normal."
              />
              <Stat
                label="Average mission length"
                abbr="x̄"
                value={fmt(selectedResult.x_bar)}
                unit="hours"
                info="The typical number of hours per mission."
              />
              <Stat
                label="Average change between missions"
                abbr="mR̄, average moving range"
                value={fmt(selectedResult.mr_bar)}
                unit="hours"
                info="How much mission length usually changes from one mission to the next."
              />
              <Stat
                label="Normal spread"
                abbr="σ̂, short-term standard deviation"
                value={fmt(selectedResult.sigma_short)}
                unit="hours"
                info="How far mission lengths normally vary around the average."
              />
              <Stat
                label="Missions"
                abbr="n"
                value={selectedResult.n}
                info="Number of missions you entered."
              />
            </dl>
            <ImrSpark
              title="Hours per mission (Individuals chart)"
              info={`Each mission's hours, in order. Red points fall outside the upper or lower limit: something may have changed and is worth checking. Only points outside the limits are flagged; no other pattern rules are applied. Limits use the standard two-point constant E₂ ≈ ${fmt(selectedResult.E2, 3)}.`}
              points={selectedResult.individuals.points}
              cl={selectedResult.individuals.cl}
              ucl={selectedResult.individuals.ucl}
              lcl={selectedResult.individuals.lcl}
              valueKey="value"
            />
            <ImrSpark
              title="Change from the previous mission (Moving-range chart)"
              info={`How much each mission's hours changed from the mission before. Red points are jumps above the upper limit, bigger than normal. The upper limit uses the standard constant D₄ = ${fmt(selectedResult.D4, 3)}; the lower limit is 0.`}
              points={selectedResult.moving_range.points}
              cl={selectedResult.moving_range.cl}
              ucl={selectedResult.moving_range.ucl}
              lcl={selectedResult.moving_range.lcl}
              valueKey="mr"
            />
          </section>
        )}
      </ResultModal>
    </article>
  )
}

function CheckPage({ api, check, setCheck, onOpenHelp }) {
  const active = CHECKS.find((c) => c.id === check) || CHECKS[0]

  return (
    <>
      <header className="top top-compact">
        <div className="hero">
          <h1>Service before the next mission — or ok to fly?</h1>
          <p className="lede lede-compact">
            Enter hours and failures, then Run.{' '}
            <button type="button" className="footer-link" onClick={onOpenHelp}>
              How to use
            </button>
          </p>
        </div>
        <ApiBadge api={api} />
      </header>

      <nav className="tabs" aria-label="Which check to run">
        {CHECKS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={check === c.id ? 'tab active' : 'tab'}
            onClick={() => setCheck(c.id)}
            aria-current={check === c.id ? 'page' : undefined}
          >
            <span className="tab-short">{c.short}</span>
            <span className="tab-label">{c.label}</span>
          </button>
        ))}
      </nav>

      <h2 className="page-title title-with-info">
        {active.label}
        <InfoTip topic={active.label} text={active.blurb} />
      </h2>

      {check === 'fixed' && <WeibullPage estimateM={false} api={api} />}
      {check === 'free' && <WeibullPage estimateM={true} api={api} />}
      {check === 'imr' && <ImrPage api={api} />}
    </>
  )
}

export default function App() {
  const [nav, setNav] = useState('check')
  const [check, setCheck] = useState('fixed')
  const [api, setApi] = useState({ state: 'checking' })

  useEffect(() => {
    checkApi()
      .then((r) => setApi({ state: 'ok', message: r.message || 'ok' }))
      .catch(() => setApi({ state: 'down' }))
  }, [])

  function openCheck(checkId) {
    if (checkId) setCheck(checkId)
    setNav('check')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goNav(id) {
    setNav(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-frame">
      <header className="site-nav" role="banner">
        <button type="button" className="site-brand" onClick={() => goNav('check')}>
          <span className="site-mark">kskbl</span>
          <span className="site-product">Fleet desk</span>
        </button>
        <nav className="site-links" aria-label="Site">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={nav === item.id ? 'site-link active' : 'site-link'}
              onClick={() => goNav(item.id)}
              aria-current={nav === item.id ? 'page' : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="shell">
        {nav === 'check' && (
          <CheckPage
            api={api}
            check={check}
            setCheck={setCheck}
            onOpenHelp={() => goNav('help')}
          />
        )}
        {nav === 'history' && <HistoryPage key={nav} />}
        {nav === 'help' && (
          <ManualPage
            onOpenCheck={openCheck}
            onOpenApi={() => goNav('api')}
            apiReady={api.state === 'ok'}
          />
        )}
        {nav === 'api' && <ApiDocsPage />}
        {nav === 'contributor' && <ContributorPage onOpenHelp={() => goNav('help')} />}

        <footer>
          <button type="button" className="footer-link" onClick={() => goNav('check')}>
            Check
          </button>
          {' · '}
          <button type="button" className="footer-link" onClick={() => goNav('history')}>
            History
          </button>
          {' · '}
          <button type="button" className="footer-link" onClick={() => goNav('help')}>
            Help
          </button>
          {' · '}
          <button type="button" className="footer-link" onClick={() => goNav('api')}>
            API docs
          </button>
          {' · '}
          <button type="button" className="footer-link" onClick={() => goNav('contributor')}>
            Contributor
          </button>
        </footer>
      </div>
    </div>
  )
}
