import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JobItem, JobObservation } from './chat-queue-client.ts'

export type JobFilter = 'active' | 'attention' | 'finished' | 'all'
export type JobGrouping = 'machine' | 'chat' | 'none'
export const jobPriority = { failed: 0, unknown: 1, running: 2, queued: 3, cancelled: 4, completed: 5 }

export function isLive(item: Pick<JobItem, 'state'>): boolean {
  return item.state === 'queued' || item.state === 'running' || item.state === 'unknown'
}

/** The one problem a row should name, most urgent first. */
export function attentionLabel(item: JobItem): string | undefined {
  if (item.deliveryError !== undefined) return 'Could not reach its Chat'
  if (item.checkError !== undefined && isLive(item)) return /AUTH_REQUIRED|authentication/i.test(item.checkError) ? 'Machine needs sign-in' : 'Checks failing'
  if (item.paused) return 'Checks paused'
  if (item.attentionMessage !== undefined) return item.attentionMessage
  if (item.awaitingVerification) return 'Confirming exit'
  return undefined
}

/** Failed jobs and anything whose monitoring or follow-up needs a person. */
export function needsAttention(item: JobItem): boolean {
  return item.state === 'failed' || item.state === 'unknown' || attentionLabel(item) !== undefined
}

export function matchesJobFilter(item: JobItem, filter: JobFilter): boolean {
  switch (filter) {
    case 'active': return isLive(item)
    case 'attention': return needsAttention(item)
    case 'finished': return !isLive(item)
    case 'all': return true
  }
}

export function matchesJobQuery(item: JobItem, query: string, machine: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [item.label, item.observerId, item.state, machine, item.cwd ?? '', ...item.tags].join(' ').toLowerCase()
  return words.every(word => haystack.includes(word))
}

export function jobDot(item: JobItem): StateDotState {
  if (item.state === 'failed') return 'error'
  if (item.state === 'unknown' || (isLive(item) && attentionLabel(item) !== undefined)) return 'warning'
  if (item.state === 'running') return 'ongoing'
  if (item.state === 'completed') return 'done'
  return 'idle'
}

export function stateLabel(item: Pick<JobItem, 'state'>): string {
  return item.state.charAt(0).toUpperCase() + item.state.slice(1)
}

/** "in 4m", "due", or "paused"; scheduled checks are in the future, unlike observation ages. */
export function nextCheckLabel(item: JobItem, now: number): string {
  if (item.paused) return 'Paused'
  if (item.nextCheckAt === undefined) return '—'
  const seconds = Math.round((Date.parse(item.nextCheckAt) - now) / 1000)
  if (!Number.isFinite(seconds)) return '—'
  if (seconds <= 0) return 'Due'
  if (seconds < 60) return `in ${seconds}s`
  if (seconds < 3570) return `in ${Math.round(seconds / 60)}m`
  const minutes = Math.round(seconds / 60)
  return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function folderName(cwd: string | undefined): string {
  if (cwd === undefined) return 'Chat'
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
}

/** The command a person can run to stop the job; Queue itself never cancels work. */
export function cancelCommand(item: Pick<JobItem, 'observerKind' | 'observerId'>): string {
  if (item.observerKind === 'slurm') return `scancel ${item.observerId}`
  if (item.observerKind === 'pbs') return `qdel ${item.observerId}`
  return `kill ${item.observerId}`
}

/** Keep state or phase changes and the newest row; repeated identical observations add nothing. */
export function timeline(observations: readonly JobObservation[]): JobObservation[] {
  const ordered = [...observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
  const changes = ordered.filter((row, index) => index === 0 || row.state !== ordered[index - 1]!.state || row.phase !== ordered[index - 1]!.phase)
  const latest = ordered.at(-1)
  if (latest !== undefined && changes.at(-1) !== latest) changes.push(latest)
  return changes.reverse()
}

export function shorten(text: string, limit = 160): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}
