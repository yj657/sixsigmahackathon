import { useEffect, useId, useMemo, useRef, useState, startTransition } from 'react'
import { API_URL, analyzeFleet, checkApi, runImr } from './api.js'
import { appendHistory, clearHistory, loadHistory } from './history.js'
import { IMR_SAMPLES, SAMPLES } from './samples.js'
import {
  IMR_ASSUMPTION,
  NOT_A_GUARANTEE,
  NOT_A_GUARANTEE_DETAIL,
  decisionHeadline,
  historyCallLabel,
  historyNeedsAttention,
  imrBasis,
  meetsThreshold,
  weibullAssumption,
  weibullBasis,
} from './resultText.js'
// Imported (not referenced by URL) so Vite bundles it with a hashed, relative path that
// works under Connect's /content/<guid>/ prefix.
import yijiaPhoto from './assets/yijia-jiang.jpg'

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
      'Main tool for technicians: enter flight hours and failures, and see whether model-estimated reliability for the next planned hours meets the 90% threshold. Assumes parts wear out with age (shape m = 2).',
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

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const MAX_SHOWN_ERRORS = 6

function splitEntries(text) {
  const t = String(text ?? '').trim()
  return t === '' ? [] : t.split(/[\s,;]+/).filter(Boolean)
}

function readNumber(raw) {
  const s = String(raw ?? '').trim()
  if (!NUMBER_RE.test(s)) return NaN
  return Number(s)
}

/**
 * Check the Weibull form before anything is sent. Returns { errors, fields, values }.
 * The backend repeats every check and stays the authority; this only gives faster,
 * clearer feedback.
 */
function validateWeibullInputs({ timesText, failedText, planHours, currentAge }) {
  const errors = []
  const fields = {}
  const tParts = splitEntries(timesText)
  const fParts = splitEntries(failedText)
  const times = []
  const failed = []

  if (tParts.length === 0) {
    errors.push('Flight hours: enter at least one number.')
    fields.times = true
  }
  tParts.forEach((p, i) => {
    const n = readNumber(p)
    if (!Number.isFinite(n)) {
      errors.push(`Flight hours, entry ${i + 1} ("${p}"): not a number. Use digits like 120 or 87.5.`)
      fields.times = true
    } else if (n <= 0) {
      errors.push(`Flight hours, entry ${i + 1} (${p}): must be greater than 0.`)
      fields.times = true
    } else {
      times.push(n)
    }
  })

  if (fParts.length === 0) {
    errors.push('Did it fail?: enter one 0 or 1 per drone.')
    fields.failed = true
  }
  fParts.forEach((p, i) => {
    const n = readNumber(p)
    if (n === 0 || n === 1) {
      failed.push(n)
    } else {
      errors.push(`Did it fail?, entry ${i + 1} ("${p}"): must be 0 (still flying) or 1 (failed).`)
      fields.failed = true
    }
  })

  if (tParts.length > 0 && fParts.length > 0 && tParts.length !== fParts.length) {
    errors.push(
      `You entered ${tParts.length} flight-hour values but ${fParts.length} failure flags. Each drone needs one of each, in the same order.`,
    )
    fields.times = true
    fields.failed = true
  }

  const age = readNumber(currentAge)
  if (!Number.isFinite(age)) {
    errors.push('Drone age now: enter the hours already flown (0 for a new drone).')
    fields.age = true
  } else if (age < 0) {
    errors.push('Drone age now: cannot be negative.')
    fields.age = true
  }

  const plan = readNumber(planHours)
  if (!Number.isFinite(plan)) {
    errors.push('Planned flight hours: enter a number greater than 0.')
    fields.plan = true
  } else if (plan <= 0) {
    errors.push('Planned flight hours: must be greater than 0.')
    fields.plan = true
  }

  return { errors, fields, values: { times, failed, plan_hours: plan, current_age: age } }
}

function ValidationList({ id, errors }) {
  if (errors.length === 0) return null
  const shown = errors.slice(0, MAX_SHOWN_ERRORS)
  const more = errors.length - shown.length
  return (
    <div id={id} className="validation" role="status" aria-live="polite">
      <p className="validation-title">Please fix before running:</p>
      <ul>
        {shown.map((msg) => (
          <li key={msg}>{msg}</li>
        ))}
        {more > 0 && <li>…and {more} more.</li>}
      </ul>
    </div>
  )
}

function ReliabilityCurve({ c, m = 2, currentAge = 0, endAge, B10 }) {
  const W = 560
  const H = 200
  const pad = { l: 36, r: 16, t: 16, b: 28 }
  const tMax = Math.max(c * 1.4, endAge * 1.2, B10 * 1.5, 50)
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
      {currentAge > 0 && (
        <>
          <rect
            className="interval"
            x={x(currentAge)}
            y={pad.t}
            width={Math.max(x(endAge) - x(currentAge), 1)}
            height={H - pad.t - pad.b}
          />
          <line className="mark now" x1={x(currentAge)} x2={x(currentAge)} y1={pad.t} y2={H - pad.b} />
        </>
      )}
      <line className="mark" x1={x(endAge)} x2={x(endAge)} y1={pad.t} y2={H - pad.b} />
      <text className="axis" x={x(endAge)} y={H - 8} textAnchor="middle">
        {currentAge > 0 ? `${fmt(currentAge, 0)}→${fmt(endAge, 0)} h` : `plan ${fmt(endAge, 0)} h`}
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

// Facts every result is based on (sample size, failures, age, plan), shown as one row.
function BasisRow({ items }) {
  return (
    <dl className="basis" aria-label="This result is based on">
      {items.map((it) => (
        <div key={it.key}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// One short model-assumption line; the longer explanation sits behind the info icon.
function AssumptionLine({ topic, summary, detail }) {
  return (
    <p className="assumption">
      <span className="assumption-label">Model:</span> {summary}
      <InfoTip topic={topic} text={detail} />
    </p>
  )
}

function NotAGuarantee() {
  return (
    <p className="guarantee-note">
      {NOT_A_GUARANTEE}
      <InfoTip topic="Not a guarantee" text={NOT_A_GUARANTEE_DETAIL} />
    </p>
  )
}

// One Weibull result view for the Check page and the History detail. The decision sentence
// comes from the backend (decision_message); the frontend never re-applies the rule.
function WeibullResultView({ result, estimateM }) {
  const age = Number.isFinite(result.current_age) ? result.current_age : 0
  const end = Number.isFinite(result.end_age) ? result.end_age : age + result.plan_hours
  const rFuture = Number.isFinite(result.R_future) ? result.R_future : result.R_plan
  const assumption = weibullAssumption(result, estimateM)
  return (
    <section className="result" aria-live="polite">
      <p className={meetsThreshold(result) ? 'call safe' : 'call danger'}>
        <strong>{decisionHeadline(result)}</strong>
      </p>
      <BasisRow items={weibullBasis(result)} />
      <AssumptionLine
        topic={estimateM ? 'Estimated shape' : 'Fixed shape m = 2'}
        summary={assumption.summary}
        detail={assumption.detail}
      />
      <NotAGuarantee />

      <h3 className="stats-head">
        Next interval (conditional): {fmt(age, 0)} → {fmt(end, 0)} flight hours
        <InfoTip
          topic="Next interval"
          text={`Conditional results: for a drone that has already flown ${fmt(age, 0)} hours without failing, over the next ${fmt(result.plan_hours, 0)} hours. The 90% threshold is applied to this chance.`}
        />
      </h3>
      <dl className="stats">
        <Stat
          label="Chance to get through the next interval"
          abbr="conditional reliability"
          value={fmtPct(rFuture)}
          info={`Given the drone has already flown ${fmt(age, 0)} hours, the chance it flies the next ${fmt(result.plan_hours, 0)} hours without failing. 90% or more meets the threshold. For a new drone (age 0) this equals the lifetime reliability over the planned hours.`}
        />
        <Stat
          label="Failure rate at end of interval"
          abbr="hazard z"
          value={fmt(result.z_plan, 5)}
          unit="per flight hour"
          info={`How fast a drone is failing once it reaches ${fmt(end, 0)} hours. Higher is riskier.`}
        />
      </dl>

      <h3 className="stats-head">
        Lifetime (from a new drone)
        <InfoTip
          topic="Lifetime"
          text="Lifetime results describe a brand-new drone from this fleet, counted from 0 flight hours. They do not change with the drone's current age."
        />
      </h3>
      <dl className="stats">
        <Stat
          label="10% failure age"
          abbr="B10 life"
          value={fmt(result.B10)}
          unit="flight hours"
          info="Counted from new: by this age, 1 drone in 10 is expected to have failed."
        />
        <Stat
          label="Average life"
          abbr="MTTF, mean time to failure"
          value={fmt(result.mttf)}
          unit="flight hours"
          info="Counted from new: how long a drone lasts on average before it fails."
        />
        <Stat
          label="Characteristic life"
          abbr="ĉ"
          value={fmt(result.c_hat)}
          unit="flight hours"
          info="Counted from new: by this age, about 63% of drones are expected to have failed."
        />
        <Stat
          label={estimateM ? 'Wear-out shape, estimated' : 'Wear-out shape, fixed'}
          abbr={estimateM ? 'm̂' : 'm'}
          value={fmt(result.m, estimateM ? 3 : 0)}
          info={
            estimateM
              ? 'Estimated from your data. Above 1: failure rate rises with age. About 1: constant. Below 1: falls with age.'
              : 'Set to 2, not estimated: the model assumes the failure rate rises with age.'
          }
        />
      </dl>

      <h3 className="chart-head">
        Lifetime reliability curve (from new)
        <InfoTip
          topic="Lifetime reliability curve"
          text="The share of new drones still working at each age, in flight hours. The horizontal line is 90% and the dot is the 10% failure age (B10). For an older drone, the shaded band is the next interval; its conditional chance is shown above, not read off this curve."
        />
      </h3>
      <ReliabilityCurve c={result.c_hat} m={result.m} currentAge={age} endAge={end} B10={result.B10} />
    </section>
  )
}

// What the I-MR chart monitors, and how many missions it used. Shared by Check and History.
function ImrBasisAndAssumption({ result }) {
  return (
    <>
      <BasisRow items={imrBasis(result)} />
      <AssumptionLine
        topic="What the I-MR chart monitors"
        summary={IMR_ASSUMPTION.summary}
        detail={IMR_ASSUMPTION.detail}
      />
    </>
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
  const [planHours, setPlanHours] = useState(String(initial.plan_hours))
  const [currentAge, setCurrentAge] = useState(String(initial.current_age ?? 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  function loadSample(key) {
    const s = SAMPLES[key]
    startTransition(() => {
      setTimesText(s.times.join(', '))
      setFailedText(s.failed.join(', '))
      setPlanHours(String(s.plan_hours))
      setCurrentAge(String(s.current_age ?? 0))
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
      if (check.errors.length > 0) {
        throw new Error('Some inputs need fixing; see the list under the form.')
      }
      const { times, failed, plan_hours, current_age } = check.values
      const out = await analyzeFleet({
        times,
        failed,
        plan_hours,
        current_age,
        m: 2,
        estimate_m: estimateM,
      })
      appendHistory({
        kind: estimateM ? 'free-m' : 'weibull-m2',
        title: estimateM ? 'How sharp is the wear-out?' : 'Should we service now?',
        summary: `age ${fmt(out.current_age, 0)} h + ${fmt(out.plan_hours, 0)} h · chance ${fmtPct(out.R_future)} · ĉ ${fmt(out.c_hat)} h`,
        call: out.call,
        detail: {
          times,
          failed,
          plan_hours: out.plan_hours,
          current_age: out.current_age,
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

  const check = useMemo(
    () => validateWeibullInputs({ timesText, failedText, planHours, currentAge }),
    [timesText, failedText, planHours, currentAge],
  )
  const errorsId = estimateM ? 'free-input-errors' : 'fixed-input-errors'

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
            aria-invalid={!!check.fields.times}
            aria-describedby={check.fields.times ? errorsId : undefined}
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
            aria-invalid={!!check.fields.failed}
            aria-describedby={check.fields.failed ? errorsId : undefined}
          />

          <FieldLabel
            htmlFor="age"
            topic="Drone age now"
            info="Flight hours this drone has already flown. Use 0 for a new drone. The check asks whether it gets through the planned hours on top of this age."
          >
            Drone age now, in flight hours (current_age)
          </FieldLabel>
          <input
            id="age"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={currentAge}
            onChange={(e) => setCurrentAge(e.target.value)}
            aria-invalid={!!check.fields.age}
            aria-describedby={check.fields.age ? errorsId : undefined}
          />

          <FieldLabel
            htmlFor="plan"
            topic="Planned flight hours before next service"
            info="Additional flight hours planned from now until the next service."
          >
            Planned flight hours before next service (plan_hours)
          </FieldLabel>
          <input
            id="plan"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={planHours}
            onChange={(e) => setPlanHours(e.target.value)}
            aria-invalid={!!check.fields.plan}
            aria-describedby={check.fields.plan ? errorsId : undefined}
          />
        </div>

        <ValidationList id={errorsId} errors={check.errors} />

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || api.state === 'down' || check.errors.length > 0}
          >
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
        {result && <WeibullResultView result={result} estimateM={estimateM} />}
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
            <ImrBasisAndAssumption result={result} />
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

// A word in the Help text with its plain-English definition behind an info icon.
function Term({ children, tip }) {
  return (
    <>
      <strong>{children}</strong>
      <InfoTip topic={typeof children === 'string' ? children : 'this term'} text={tip} />
    </>
  )
}

const TIP_CONDITIONAL =
  'The chance that this drone, having already flown its current age without failing, also gets through the planned additional hours. This is the number the 90% threshold is checked against.'
const TIP_LIFETIME =
  'Numbers for a brand-new drone from this fleet, counted from 0 flight hours: 10% failure age (B10), average life (MTTF) and characteristic life. They do not change with the drone you are checking.'
const TIP_STILL_FLYING =
  'A drone that has not failed still tells you it lasted at least that long. The model uses that, so leaving these drones out would make the fleet look worse than it is.'
const TIP_SHAPE =
  'How the failure risk changes with age. The main check assumes it rises with age (shape fixed at 2). The wear-pattern check estimates it from your data instead.'
const TIP_ESTIMATE =
  'The numbers come from a statistical model fitted to the hours you entered. They help you decide when to review maintenance, but they can be wrong if the data are incomplete or the assumptions do not hold, and they never certify that a drone is safe to fly.'

// Small line icons for the Help page (decorative: the text next to them carries the meaning).
const HELP_ICONS = {
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  run: <path d="M8 5.5v13l10.5-6.5z" />,
  results: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 15l3-3 2.5 2.5L17 10" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  shield: <path d="M12 3l7 3v5.5c0 4.4-3 7.9-7 9.5-4-1.6-7-5.1-7-9.5V6z" />,
}

function HelpIcon({ name }) {
  return (
    <svg
      className="help-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {HELP_ICONS[name]}
    </svg>
  )
}

// Quick Start steps. Every label matches the live form (verified against WeibullPage).
const QUICK_START = [
  {
    icon: 'data',
    title: 'Choose data',
    action: (
      <>
        Open <strong>Check → Should we service now?</strong> Click a sample or type each drone&apos;s
        flight hours and a <code>1</code>/<code>0</code> for failed.
      </>
    ),
    tip: 'One number per drone, in the same order in both boxes. 1 = failed, 0 = still flying or removed without failing. Still-flying drones count: they lasted at least that long. The form opens with the wearout_baseline sample already filled in.',
  },
  {
    icon: 'clock',
    title: 'Set flight hours',
    action: (
      <>
        <strong>Drone age now</strong> (<code>0</code> = new) and <strong>planned flight hours
        before next service</strong>.
      </>
    ),
    tip: 'Drone age now (current_age) is the hours the drone you are checking has already flown. Planned flight hours (plan_hours) are the additional hours you plan to fly from now until the next service.',
  },
  {
    icon: 'run',
    title: 'Run analysis',
    action: (
      <>
        Press <strong>Run maintenance check</strong>.
      </>
    ),
    tip: 'Run stays greyed out while anything needs fixing; a “Please fix before running” list under the form says what. It is also greyed out if the calculator status says Offline.',
  },
  {
    icon: 'results',
    title: 'Review results',
    action: (
      <>
        Read the <strong>banner</strong> first, then what it is based on.
      </>
    ),
    tip: 'Under the banner: number of drones and recorded failures, drone age now, planned additional hours, and the model assumption. Then the next-interval chance (what the 90% rule uses) and lifetime numbers for a new drone.',
  },
]

function ManualPage({ onOpenCheck, onOpenApi, apiReady }) {
  return (
    <article className="manual">
      <header className="page-hero">
        <h1>Help · User manual</h1>
        <p className="lede">
          How to use the desk, in plain English. Developers: see the{' '}
          <button type="button" className="footer-link" onClick={onOpenApi}>
            API docs
          </button>{' '}
          page.
        </p>
      </header>

      <section className="manual-block quickstart" aria-labelledby="qs-title">
        <h3 id="qs-title">Quick start</h3>
        <ol className="flow">
          {QUICK_START.map((step, i) => (
            <li key={step.title} className="flow-step">
              <div className="flow-head">
                <span className="flow-num" aria-hidden="true">
                  {i + 1}
                </span>
                <HelpIcon name={step.icon} />
                <span className="flow-title">{step.title}</span>
                <InfoTip topic={step.title} text={step.tip} />
              </div>
              <p className="flow-action">{step.action}</p>
            </li>
          ))}
        </ol>
        <div className="quickstart-foot">
          <button type="button" className="primary" onClick={() => onOpenCheck('fixed')}>
            Start: Should we service now?
          </button>
          <span className="manual-note">
            Calculator: <strong>{apiReady ? 'Ready' : 'Offline'}</strong>
          </span>
        </div>
      </section>

      <section className="manual-block" aria-labelledby="outcomes-title">
        <h3 id="outcomes-title">What the banner can say</h3>
        <div className="outcomes">
          <div className="outcome safe">
            <HelpIcon name="check" />
            <div>
              <p className="outcome-title">Meets the 90% threshold</p>
              <p className="outcome-text">“Model-estimated reliability meets the 90% threshold.”</p>
            </div>
          </div>
          <div className="outcome danger">
            <HelpIcon name="alert" />
            <div>
              <p className="outcome-title">Below the 90% threshold</p>
              <p className="outcome-text">
                “Model-estimated reliability is below the 90% threshold; maintenance review is
                recommended.”
              </p>
            </div>
          </div>
        </div>
        <p className="outcome-rule">
          The 90% applies to the <Term tip={TIP_CONDITIONAL}>chance to get through the next interval</Term>
          : from the drone&apos;s age now to age now + planned hours. Exactly 90% meets it.
        </p>
        <p className="outcome-note">
          <HelpIcon name="shield" />
          <span>
            Estimates <Term tip={TIP_ESTIMATE}>support maintenance decisions</Term>; they do not
            guarantee flight safety.
          </span>
        </p>
      </section>

      <section className="manual-block">
        <h3>What to type in</h3>
        <table className="manual-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>What to enter</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Flight hours per drone</td>
              <td>
                One number per drone, commas between. The hours when it failed, or its hours so far
                if it is <Term tip={TIP_STILL_FLYING}>still flying</Term>. Must be above 0.
              </td>
            </tr>
            <tr>
              <td>Did it fail?</td>
              <td>
                Same order as the hours: <code>1</code> = failed, <code>0</code> = still flying or
                removed without failing.
              </td>
            </tr>
            <tr>
              <td>Drone age now</td>
              <td>
                Hours the drone you are checking has already flown. <code>0</code> for a new drone.
              </td>
            </tr>
            <tr>
              <td>Planned flight hours before next service</td>
              <td>The extra hours you plan to fly from now until the next service.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="manual-block">
        <h3>Also in the results</h3>
        <ul className="chip-list">
          <li>
            <Term tip="How many drones the result is based on, and how many of them failed. Few failures means a rougher estimate.">
              Drones · recorded failures
            </Term>
          </li>
          <li>
            <Term tip={TIP_SHAPE}>Model assumption</Term>
          </li>
          <li>
            <Term tip={TIP_LIFETIME}>Lifetime (from a new drone)</Term>
          </li>
          <li>
            <Term tip="Every number has a small i icon: hover, tab to it, or tap it for a short explanation. Close the results with Close, the dark background or Escape.">
              Info icons
            </Term>
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
              <td>wearout_baseline</td>
              <td>
                5 drones, 3 failures, age 0, plan 100 h → 78.95%{' '}
                <span className="badge danger">Below 90%</span>
              </td>
            </tr>
            <tr>
              <td>baseline · plan 50 h</td>
              <td>
                Same fleet, plan 50 h → 94.26% <span className="badge safe">Meets 90%</span>
              </td>
            </tr>
            <tr>
              <td>baseline · drone at 150 h</td>
              <td>
                Same fleet, plan 50 h, drone already at 150 h → 66.12%{' '}
                <span className="badge danger">Below 90%</span>
              </td>
            </tr>
            <tr>
              <td>early_wearout</td>
              <td>
                Parts wear out fast → 8.66% <span className="badge danger">Below 90%</span>
              </td>
            </tr>
            <tr>
              <td>edge_all_censored</td>
              <td>
                No failures yet → <span className="badge neutral">Could not run</span> no numbers are
                invented
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
            <strong>How sharp is the wear-out?</strong> Same form and banner, but it estimates the{' '}
            <Term tip={TIP_SHAPE}>wear-out shape</Term> from your data instead of assuming it.
            Needs at least two failures. Use it as a second opinion.
          </li>
          <li>
            <strong>Are mission hours steady?</strong> Enter mission lengths in the order flown. Red
            points mean a mission (or the jump from the one before) was outside the normal range and
            is worth checking. It does not predict failures.
          </li>
        </ul>
      </section>

      <section className="manual-block">
        <h3>If something looks wrong</h3>
        <ul className="manual-list">
          <li>
            <strong>Calculator status: Offline</strong> — Run is greyed out. Ask your team to start
            the calculator (API).
          </li>
          <li>
            <strong>Please fix before running</strong> — correct each item in the list (for example
            a missing value, a “failed” that is not 0 or 1, or lists of different lengths).
          </li>
          <li>
            <strong>Could not run</strong> (red box above the form) — the calculator explains why,
            such as “need at least one failure”. If it says “These data cannot be calculated right
            now. Please check the data.”, the numbers are valid but the model cannot give a
            trustworthy answer (for example, every failure at exactly the same hour on the
            wear-out check).
          </li>
          <li>
            <strong>History</strong> keeps your past runs in this browser only; use{' '}
            <strong>Clear history</strong> to remove them.
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
      note: 'Weibull fit. Body: times, failed (numbers 0/1), optional plan_hours, current_age, m, estimate_m. Returns R_future, call and decision_message. 400 = invalid input, 422 = cannot be calculated. Use this on Connect.',
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
  -d '{"times":[100,120,150,200,200],"failed":[1,1,1,0,0],"plan_hours":100,"current_age":0}'`}</pre>
        <p className="manual-note">
          Expect c_hat ≈ 205.670, R_future ≈ 0.7895, n = 5, r = 3 and the below-90%
          decision_message. (The API also returns call &quot;maintain now&quot; / &quot;ok to
          fly&quot; for older clients; the desk shows only decision_message.)
        </p>
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
    photo: yijiaPhoto,
    alt: 'Yijia Jiang',
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
            alt={person.alt ?? `${person.name}, team kskbl`}
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
                      historyNeedsAttention(e) ? 'history-call danger' : 'history-call safe'
                    }
                  >
                    {historyCallLabel(e)}
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
          <WeibullResultView result={selectedResult} estimateM={selected.kind === 'free-m'} />
        )}
        {selected && selectedResult && selected.kind === 'imr' && (
          <section className="result">
            <ImrBasisAndAssumption result={selectedResult} />
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
          <h1>Does the next interval meet the 90% reliability threshold?</h1>
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
