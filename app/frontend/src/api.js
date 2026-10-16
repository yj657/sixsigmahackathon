// The ONLY place the API base URL lives.
// Default: deployed Posit Connect API. Override with VITE_API_URL for local:
//   VITE_API_URL=http://127.0.0.1:8000 npm run dev
export const API_URL = (
  import.meta.env.VITE_API_URL ||
  'https://connect.systems-apps.com/content/61dce257-81d0-44e8-84c4-c10cfeae1bbe'
).replace(/\/$/, '')

async function getJson(path, options) {
  const res = await fetch(`${API_URL}${path}`, options)
  let body = null
  const text = await res.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { detail: text.slice(0, 200) }
  }
  if (!res.ok) {
    const detail =
      typeof body?.detail === 'string'
        ? body.detail
        : Array.isArray(body?.detail)
          ? body.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
          : `HTTP ${res.status}`
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return body
}

export function checkApi() {
  return getJson('/')
}

export function analyzeFleet({ times, failed, plan_hours = 100, m = 2 }) {
  return getJson('/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ times, failed, plan_hours, m }),
  })
}
