import { browserBoot, refreshBrowserBoot } from './browser-boot.ts'

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function queueState(value: unknown): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' | undefined {
  switch (value) {
    case 'queued': case 'running': case 'completed': case 'failed': case 'cancelled': case 'unknown': return value
    default: return undefined
  }
}

function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }

export function decodeChatQueue(value: unknown, sessionId: string) {
  const view = record(value)
  if (view?.schemaVersion !== 1 || view.sessionId !== sessionId || !Array.isArray(view.items)) throw new Error('Invalid Chat Queue response.')
  return view.items.map((value: unknown) => {
    const item = record(value)
    const target = record(item?.target)
    const state = queueState(item?.state)
    if (item === undefined || typeof item.id !== 'string' || typeof item.label !== 'string' || state === undefined
      || typeof item.observerId !== 'string' || typeof item.observerKind !== 'string'
      || (item.relation !== 'owned' && item.relation !== 'subscribed')
      || (target?.kind !== 'local' && !(target?.kind === 'machine' && typeof target.machineId === 'string'))) throw new Error('Invalid Chat Queue item.')
    return {
      purpose: text(item.purpose), continuation: text(item.continuation), delivery: text(item.delivery), deliveryStatus: text(item.deliveryStatus), deliveryError: text(item.deliveryError),
      id: item.id, label: item.label, state, observerId: item.observerId, observerKind: item.observerKind,
      relation: item.relation, machineId: target.kind === 'local' ? undefined : text(target.machineId),
      observedAt: text(item.observedAt), evidence: text(item.evidence), nextCheckAt: text(item.nextCheckAt), checkError: text(item.checkError),
      observationSource: text(item.observationSource), startedAt: text(item.startedAt), phase: text(item.phase), awaitingVerification: item.awaitingVerification === true,
      elapsedSeconds: typeof item.elapsedSeconds === 'number' && Number.isFinite(item.elapsedSeconds) && item.elapsedSeconds >= 0 ? item.elapsedSeconds : undefined,
    }
  })
}

export type ChatQueueItem = ReturnType<typeof decodeChatQueue>[number]

/** Read persisted observations; polling this endpoint never probes or wakes an Agent. */
export async function readChatQueue(sessionId: string, signal: AbortSignal): Promise<ChatQueueItem[]> {
  return await requestChatQueue(sessionId, signal)
}

/** Explicit one-item deterministic check; never launches an Agent. */
export async function refreshChatQueueItem(sessionId: string, id: string, signal: AbortSignal): Promise<ChatQueueItem[]> {
  return await requestChatQueue(sessionId, signal, id)
}

async function requestChatQueue(sessionId: string, signal: AbortSignal, id?: string): Promise<ChatQueueItem[]> {
  const boot = browserBoot() ?? await refreshBrowserBoot()
  if (boot === undefined) throw new Error('Chat Queue is unavailable.')
  const send = (nonce: string) => fetch(id === undefined ? `${boot.queueSettingsBridgePath}?${new URLSearchParams({ view: 'chat', sessionId })}` : boot.queueSettingsBridgePath, {
    credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'x-dsh-slop-csrf': nonce, ...(id === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(id === undefined ? {} : { method: 'PUT', body: JSON.stringify({ scope: 'chat-refresh', sessionId, id }) }),
  })
  let response = await send(boot.csrfNonce)
  if (response.status === 403) {
    const fresh = await refreshBrowserBoot()
    if (fresh !== undefined && fresh.csrfNonce !== boot.csrfNonce) response = await send(fresh.csrfNonce)
  }
  if (!response.ok) throw new Error(`Could not ${id === undefined ? 'read' : 'refresh'} Chat Queue (${response.status}).`)
  return decodeChatQueue(await response.json(), sessionId)
}

function seconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function decodeJobs(value: unknown) {
  const view = record(value)
  if (view?.schemaVersion !== 1 || !Array.isArray(view.items)) throw new Error('Invalid Jobs response.')
  const failures = Array.isArray(view.failures) ? view.failures.map(record).filter(failure => typeof failure?.id === 'string' && typeof failure.error === 'string')
    .map(failure => ({ id: String(failure?.id), error: String(failure?.error) })) : []
  const items = view.items.map((value: unknown) => {
    const item = record(value)
    const target = record(item?.target)
    const state = queueState(item?.state)
    if (item === undefined || typeof item.id !== 'string' || typeof item.label !== 'string' || state === undefined
      || typeof item.observerId !== 'string' || typeof item.observerKind !== 'string' || typeof item.sessionId !== 'string'
      || typeof item.revision !== 'number'
      || (target?.kind !== 'local' && !(target?.kind === 'machine' && typeof target.machineId === 'string'))) throw new Error('Invalid Jobs item.')
    return {
      id: item.id, label: item.label, state, observerId: item.observerId, observerKind: item.observerKind, sessionId: item.sessionId, revision: item.revision,
      machineId: target.kind === 'local' ? undefined : text(target.machineId), cwd: text(item.cwd), notes: text(item.notes),
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      paused: item.paused === true,
      purpose: text(item.purpose), continuation: text(item.continuation), deliveryStatus: text(item.deliveryStatus), deliveryError: text(item.deliveryError),
      observedAt: text(item.observedAt), evidence: text(item.evidence), nextCheckAt: text(item.nextCheckAt), nextCheckReason: text(item.nextCheckReason), checkError: text(item.checkError),
      attentionMessage: text(item.attentionMessage), observationSource: text(item.observationSource), startedAt: text(item.startedAt), createdAt: text(item.createdAt), updatedAt: text(item.updatedAt), phase: text(item.phase),
      awaitingVerification: item.awaitingVerification === true,
      consecutiveFailures: typeof item.consecutiveFailures === 'number' ? item.consecutiveFailures : 0,
      elapsedSeconds: seconds(item.elapsedSeconds), walltimeSeconds: seconds(item.walltimeSeconds), walltimeRemainingSeconds: seconds(item.walltimeRemainingSeconds),
      expectedRemainingSeconds: seconds(item.expectedRemainingSeconds), userIntervalSeconds: seconds(item.userIntervalSeconds),
    }
  })
  return { items, failures }
}

export type JobsView = ReturnType<typeof decodeJobs>
export type JobItem = JobsView['items'][number]
export type JobAction = 'check' | 'pause' | 'resume'
export interface JobEdit {
  readonly label?: string
  readonly tags?: readonly string[]
  readonly notes?: string | null
  readonly purpose?: 'monitor' | 'continue'
  readonly continuation?: string
  readonly userIntervalSeconds?: number | null
}

export function decodeJobHistory(value: unknown, id: string) {
  const view = record(value)
  if (view?.schemaVersion !== 1 || view.id !== id || !Array.isArray(view.observations)) throw new Error('Invalid job history.')
  return view.observations.flatMap((value: unknown) => {
    const row = record(value)
    const state = queueState(row?.state)
    if (row === undefined || state === undefined || typeof row.observedAt !== 'string') return []
    return [{ state, observedAt: row.observedAt, source: text(row.source), evidence: text(row.evidence) ?? '', elapsedSeconds: seconds(row.elapsedSeconds), phase: text(row.phase) }]
  })
}

export type JobObservation = ReturnType<typeof decodeJobHistory>[number]

/** Read every active Queue item plus last week's finished ones; never probes. */
export async function readJobs(signal: AbortSignal): Promise<JobsView> {
  return decodeJobs(await requestQueueBridge(signal, `?${new URLSearchParams({ view: 'jobs' })}`))
}

/** Check, pause or resume monitoring of several jobs; never touches the scheduler job itself. */
export async function runJobsAction(action: JobAction, ids: readonly string[], signal: AbortSignal): Promise<JobsView> {
  return decodeJobs(await requestQueueBridge(signal, '', { scope: 'jobs-action', action, ids }))
}

export async function editJob(id: string, expectedRevision: number, edit: JobEdit, signal: AbortSignal): Promise<JobsView> {
  return decodeJobs(await requestQueueBridge(signal, '', { scope: 'jobs-edit', id, expectedRevision, ...edit }))
}

/** Saved observations of one job, newest first. */
export async function readJobHistory(id: string, signal: AbortSignal): Promise<JobObservation[]> {
  return decodeJobHistory(await requestQueueBridge(signal, `?${new URLSearchParams({ view: 'job', id })}`), id)
}

async function requestQueueBridge(signal: AbortSignal, query: string, body?: unknown): Promise<unknown> {
  const boot = browserBoot() ?? await refreshBrowserBoot()
  if (boot === undefined) throw new Error('Queue is unavailable.')
  const send = (nonce: string) => fetch(`${boot.queueSettingsBridgePath}${query}`, {
    credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'x-dsh-slop-csrf': nonce, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { method: 'PUT', body: JSON.stringify(body) }),
  })
  let response = await send(boot.csrfNonce)
  if (response.status === 403) {
    const fresh = await refreshBrowserBoot()
    if (fresh !== undefined && fresh.csrfNonce !== boot.csrfNonce) response = await send(fresh.csrfNonce)
  }
  if (!response.ok) {
    const detail = await response.json().then(value => text(record(value)?.error), () => undefined)
    throw new Error(detail ?? `Could not ${body === undefined ? 'read' : 'update'} Jobs (${response.status}).`)
  }
  return await response.json()
}
