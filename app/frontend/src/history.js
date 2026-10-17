/** Browser-only check history (localStorage). No server, no login. */

const STORAGE_KEY = 'kskbl_check_history_v1'
const MAX_ENTRIES = 50

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveHistory(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * @param {{ kind: string, title: string, summary: string, call?: string, detail: object }} entry
 */
export function appendHistory(entry) {
  const next = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...entry,
    },
    ...loadHistory(),
  ]
  saveHistory(next)
  return next
}
