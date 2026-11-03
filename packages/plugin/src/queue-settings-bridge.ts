import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  describeNextCheck,
  isTerminalState,
  queuePurposeSchema,
  type QueueItem,
  type QueueMonitor,
  type QueueService,
  type QueueSettingsPatch,
} from '@dsh-slop/queue'
import { z } from 'zod'
import { admitLocalRequest, HttpAdmissionError, readJsonBody, writeJson } from './admission.ts'

export const QUEUE_SETTINGS_BRIDGE_PATH = '/dsh-slop/queue-settings'

type QueueSettingsService = Pick<QueueService, 'settings' | 'updateSettings' | 'list' | 'update' | 'probeNow' | 'deliveries' | 'observations'>

const chatRefreshSchema = z.object({
  scope: z.literal('chat-refresh'),
  sessionId: z.string().min(1).max(256),
  id: z.string().min(1).max(128),
}).strict()

async function continuationView(service: QueueSettingsService, item: QueueItem) {
  const records = (await service.deliveries(item.id)).filter(record => record.target.sessionId === item.attention.primary.sessionId && record.trigger.event === 'state-change')
  const latest = records.at(-1)
  const deliveryStatus = item.callback?.terminalPending || item.verificationPending ? 'awaiting-verification'
    : latest?.lastError ? 'failed'
    : latest?.receipt ?? (latest?.state === 'delivered' ? 'consumed' : latest ? 'pending' : isTerminalState(item.state) ? 'no-pending-delivery' : 'waiting-for-job')
  return { purpose: item.purpose, continuation: item.continuation, delivery: item.attention.primaryDelivery, deliveryStatus, deliveryError: latest?.lastError }
}

async function chatView(service: QueueSettingsService, sessionId: string) {
  const items = (await service.list()).filter(item => belongsToChat(item, sessionId))
  return { schemaVersion: 1, sessionId, items: await Promise.all(items.map(async item => ({
    ...await continuationView(service, item),
    id: item.id, label: item.label, state: item.state, target: item.target,
    observerId: item.observer.kind === 'process' ? String(item.observer.handle.pid) : item.observer.jobId,
    observerKind: item.observer.kind,
    relation: item.attention.primary.sessionId === sessionId ? 'owned' : 'subscribed',
    observedAt: item.lastObservation?.observedAt,
    elapsedSeconds: item.lastObservation?.elapsedSeconds,
    evidence: item.lastObservation?.evidence,
    nextCheckAt: item.nextCheckAt,
    checkError: item.lastCheckError?.message,
    observationSource: item.lastObservation?.source,
    startedAt: item.startedAt,
    phase: item.phase,
    awaitingVerification: item.callback?.terminalPending === true || item.verificationPending === true,
  }))) }
}

const JOBS_HISTORY_MS = 7 * 24 * 60 * 60 * 1_000
const JOBS_BATCH_LIMIT = 50
const JOB_HISTORY_LIMIT = 50

const jobIdsSchema = z.array(z.string().min(1).max(128)).min(1).max(JOBS_BATCH_LIMIT)
const jobsActionSchema = z.object({
  scope: z.literal('jobs-action'),
  action: z.enum(['check', 'pause', 'resume']),
  ids: jobIdsSchema,
}).strict()
const jobsEditSchema = z.object({
  scope: z.literal('jobs-edit'),
  id: z.string().min(1).max(128),
  expectedRevision: z.number().int().positive(),
  label: z.string().trim().min(1).max(256).optional(),
  tags: z.array(z.string().trim().min(1).max(128)).max(32).optional(),
  notes: z.string().trim().max(4_096).nullable().optional(),
  purpose: queuePurposeSchema.optional(),
  continuation: z.string().trim().min(1).max(4_096).optional(),
  userIntervalSeconds: z.number().int().min(60).nullable().optional(),
}).strict()

/** A live item with no scheduled check is paused: the planner skips it until a check or resume. */
function isPaused(item: QueueItem): boolean {
  return !isTerminalState(item.state) && item.nextCheckAt === undefined
}

/** Every active item plus terminal items from the last week, across Chats. */
async function jobsView(service: QueueSettingsService, failures: readonly { id: string; error: string }[] = []) {
  const cutoff = Date.now() - JOBS_HISTORY_MS
  const [settings, all] = await Promise.all([service.settings(), service.list()])
  const items = all
    .filter(item => !isTerminalState(item.state) || Date.parse(item.updatedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
  return { schemaVersion: 1, failures, items: await Promise.all(items.map(async item => ({
    ...await continuationView(service, item),
    id: item.id, label: item.label, state: item.state, target: item.target, tags: item.tags, notes: item.notes, revision: item.revision,
    observerId: item.observer.kind === 'process' ? String(item.observer.handle.pid) : item.observer.jobId,
    observerKind: item.observer.kind,
    sessionId: item.attention.primary.sessionId,
    cwd: item.attention.primary.cwd,
    paused: isPaused(item),
    observedAt: item.lastObservation?.observedAt,
    elapsedSeconds: item.lastObservation?.elapsedSeconds,
    walltimeSeconds: item.lastObservation?.walltimeSeconds,
    walltimeRemainingSeconds: item.lastObservation?.walltimeRemainingSeconds,
    expectedRemainingSeconds: item.lastObservation?.expectedRemainingSeconds,
    attentionMessage: item.lastObservation?.attention?.message,
    evidence: item.lastObservation?.evidence,
    nextCheckAt: item.nextCheckAt,
    nextCheckReason: describeNextCheck(item, settings),
    userIntervalSeconds: item.monitoring.userIntervalSeconds,
    consecutiveFailures: item.consecutiveFailures,
    checkError: item.lastCheckError?.message,
    observationSource: item.lastObservation?.source,
    startedAt: item.startedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    phase: item.phase,
    awaitingVerification: item.callback?.terminalPending === true || item.verificationPending === true,
  }))) }
}

/** Observation history for one item, newest first; reading never probes. */
async function jobHistoryView(service: QueueSettingsService, id: string) {
  const item = (await service.list()).find(entry => entry.id === id)
  if (item === undefined) throw new HttpAdmissionError(404, 'Queue item not found')
  const observations = [...await service.observations(id)]
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
    .slice(0, JOB_HISTORY_LIMIT)
  return { schemaVersion: 1, id, observations: observations.map(observation => ({
    state: observation.state, observedAt: observation.observedAt, source: observation.source,
    elapsedSeconds: observation.elapsedSeconds, phase: observation.phase,
    evidence: observation.evidence.slice(0, 2_000),
  })) }
}

async function applyJobsAction(service: QueueSettingsService, action: 'check' | 'pause' | 'resume', ids: readonly string[]) {
  const items = new Map((await service.list()).map(item => [item.id as string, item]))
  const failures: { id: string; error: string }[] = []
  // Sequential: probes of one Machine share its connection, and the service serializes runs anyway.
  for (const id of new Set(ids)) {
    const item = items.get(id)
    try {
      if (item === undefined) throw new Error('Queue item not found')
      if (action === 'check') {
        const started = Date.now()
        const checked = await service.probeNow(id)
        // A failed probe is recorded on the item rather than thrown.
        const failure = checked.lastCheckError
        if (failure !== undefined && Date.parse(failure.at) >= started) throw new Error(failure.message)
      }
      else if (isTerminalState(item.state)) throw new Error('Finished jobs have no scheduled checks')
      else if (action === 'pause') { if (!isPaused(item)) await service.update(id, { nextCheckAt: null }, item.revision) }
      else if (isPaused(item)) await service.update(id, { nextCheckAt: new Date(Date.now()).toISOString() }, item.revision)
    } catch (error) {
      failures.push({ id, error: error instanceof Error ? error.message : 'Queue action failed' })
    }
  }
  return failures
}

function belongsToChat(item: Awaited<ReturnType<QueueSettingsService['list']>>[number], sessionId: string): boolean {
  return item.attention.primary.sessionId === sessionId
    || item.attention.subscriptions.some(subscription => subscription.target.sessionId === sessionId)
}

function latestCheckAt(observationAt?: string, errorAt?: string): string | undefined {
  if (observationAt === undefined) return errorAt
  if (errorAt === undefined) return observationAt
  return Date.parse(observationAt) >= Date.parse(errorAt) ? observationAt : errorAt
}

const globalUpdateSchema = z.object({
  scope: z.literal('global'),
  expectedRevision: z.number().int().positive(),
  patch: z.object({
    profile: z.enum(['normal', 'economy', 'custom']).optional(),
    initialCheckSeconds: z.number().int().min(60).optional(),
    automaticMinimumSeconds: z.number().int().min(60).optional(),
    stableMinimumSeconds: z.number().int().min(60).optional(),
    startupWindowSeconds: z.number().int().min(60).optional(),
    startupIntervalSeconds: z.number().int().min(60).optional(),
    walltimeDivisor: z.number().int().min(1).max(100).optional(),
    durationMaximumSeconds: z.number().int().min(60).optional(),
    maximumDetectionDelaySeconds: z.number().int().min(60).optional(),
    queuedMaximumSeconds: z.number().int().min(60).optional(),
    fallbackEnabled: z.boolean().optional(),
    defaultDelivery: z.enum(['wake', 'notify']).optional(),
    defaultConditions: z.array(z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown', 'any-state-change'])).min(1).optional(),
  }).strict(),
}).strict()

const itemUpdateSchema = z.object({
  scope: z.literal('item'),
  id: z.string().min(1).max(128),
  expectedRevision: z.number().int().positive(),
  userIntervalSeconds: z.number().int().min(60).nullable(),
  purpose: queuePurposeSchema.optional(),
  continuation: z.string().trim().min(1).max(4_096).optional(),
}).strict()

async function currentView(service: QueueSettingsService): Promise<unknown> {
  const [settings, items] = await Promise.all([service.settings(), service.list()])
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1_000
  const recent = items.filter(item => Date.parse(item.updatedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
  return {
    schemaVersion: 1,
    settings,
    items: await Promise.all(recent.map(async item => ({
      ...await continuationView(service, item),
      id: item.id,
      label: item.label,
      state: item.state,
      observerKind: item.observer.kind,
      observerId: item.observer.kind === 'process' ? String(item.observer.handle.pid) : item.observer.jobId,
      updatedAt: item.updatedAt,
      target: item.target,
      revision: item.revision,
      intervalSource: item.monitoring.userIntervalSeconds === undefined ? 'global' : 'item',
      observationSource: item.lastObservation?.source,
      userIntervalSeconds: item.monitoring.userIntervalSeconds,
      delivery: item.attention.primaryDelivery,
      lastCheckAt: latestCheckAt(item.lastObservation?.observedAt, item.lastCheckError?.at),
      lastCheckError: item.lastCheckError?.message,
      nextCheckAt: item.nextCheckAt,
      nextCheckReason: describeNextCheck(item, settings),
      consecutiveFailures: item.consecutiveFailures,
      timing: {
        expectedDurationSeconds: item.monitoring.expectedDurationSeconds,
        walltimeSeconds: item.lastObservation?.walltimeSeconds,
        walltimeRemainingSeconds: item.lastObservation?.walltimeRemainingSeconds,
        startedAt: item.startedAt,
        elapsedSeconds: item.lastObservation?.elapsedSeconds,
        expectedRemainingSeconds: item.lastObservation?.expectedRemainingSeconds,
      },
      phase: item.phase,
      awaitingVerification: item.callback?.terminalPending === true,
    }))),
  }
}

/** Same-origin Queue policy and per-item override bridge. */
export async function serveQueueSettingsBridge(
  request: IncomingMessage,
  response: ServerResponse,
  nonce: string,
  service: QueueSettingsService,
  monitor: Pick<QueueMonitor, 'refresh'>,
  trustedHosts: readonly string[] = [],
): Promise<void> {
  try {
    admitLocalRequest(request, nonce, true, trustedHosts)
    const url = new URL(request.url ?? QUEUE_SETTINGS_BRIDGE_PATH, 'http://localhost')
    if (request.method === 'GET' && url.searchParams.get('view') === 'chat') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId || sessionId.length > 256 || [...url.searchParams.keys()].length !== 2) {
        throw new HttpAdmissionError(400, 'one Chat sessionId is required')
      }
      writeJson(response, 200, await chatView(service, sessionId))
      return
    }
    if (request.method === 'GET' && url.searchParams.get('view') === 'jobs') {
      if ([...url.searchParams.keys()].length !== 1) throw new HttpAdmissionError(400, 'query parameters are not allowed')
      writeJson(response, 200, await jobsView(service))
      return
    }
    if (request.method === 'GET' && url.searchParams.get('view') === 'job') {
      const id = url.searchParams.get('id')
      if (!id || id.length > 128 || [...url.searchParams.keys()].length !== 2) throw new HttpAdmissionError(400, 'one Queue item id is required')
      writeJson(response, 200, await jobHistoryView(service, id))
      return
    }
    if (url.search !== '') {
      throw new HttpAdmissionError(400, 'query parameters are not allowed')
    }
    if (request.method === 'GET') {
      writeJson(response, 200, await currentView(service))
      return
    }
    if (request.method !== 'PUT') throw new HttpAdmissionError(405, 'GET or PUT required')
    const raw = await readJsonBody(request, 'PUT')
    const refresh = chatRefreshSchema.safeParse(raw)
    if (refresh.success) {
      const current = (await service.list()).find(item => item.id === refresh.data.id && belongsToChat(item, refresh.data.sessionId))
      if (current === undefined) throw new HttpAdmissionError(404, 'Queue item not found in this Chat')
      await service.probeNow(current.id)
      await monitor.refresh()
      writeJson(response, 200, await chatView(service, refresh.data.sessionId))
      return
    }
    const jobsAction = jobsActionSchema.safeParse(raw)
    if (jobsAction.success) {
      const failures = await applyJobsAction(service, jobsAction.data.action, jobsAction.data.ids)
      await monitor.refresh()
      writeJson(response, 200, await jobsView(service, failures))
      return
    }
    const jobsEdit = jobsEditSchema.safeParse(raw)
    if (jobsEdit.success) {
      const edit = jobsEdit.data
      const current = (await service.list()).find(entry => entry.id === edit.id)
      if (current === undefined) throw new HttpAdmissionError(404, 'Queue item not found')
      await service.update(edit.id, {
        ...(edit.label === undefined ? {} : { label: edit.label }),
        ...(edit.tags === undefined ? {} : { tags: edit.tags }),
        ...(edit.notes === undefined ? {} : { notes: edit.notes === null || edit.notes === '' ? null : edit.notes }),
        ...(edit.purpose === undefined ? {} : { purpose: edit.purpose }),
        ...(edit.continuation === undefined ? {} : { continuation: edit.continuation }),
        ...(edit.userIntervalSeconds === undefined ? {} : { monitoring: { ...current.monitoring, userIntervalSeconds: edit.userIntervalSeconds ?? undefined } }),
        // A monitoring change reschedules the item; keep a paused job paused.
        ...(edit.userIntervalSeconds !== undefined && isPaused(current) ? { nextCheckAt: null } : {}),
      }, edit.expectedRevision)
      await monitor.refresh()
      writeJson(response, 200, await jobsView(service))
      return
    }
    const global = globalUpdateSchema.safeParse(raw)
    if (global.success) {
      await service.updateSettings(global.data.patch as QueueSettingsPatch, global.data.expectedRevision)
      await monitor.refresh()
      writeJson(response, 200, await currentView(service))
      return
    }
    const item = itemUpdateSchema.safeParse(raw)
    if (!item.success) throw new HttpAdmissionError(400, 'invalid Queue settings update')
    const current = (await service.list()).find((entry) => entry.id === item.data.id)
    if (current === undefined) throw new HttpAdmissionError(404, 'Queue item not found')
    await service.update(item.data.id, {
      monitoring: {
        ...current.monitoring,
        ...(item.data.userIntervalSeconds === null
          ? { userIntervalSeconds: undefined }
          : { userIntervalSeconds: item.data.userIntervalSeconds }),
      },
      ...(item.data.purpose === undefined ? {} : { purpose: item.data.purpose }),
      ...(item.data.continuation === undefined ? {} : { continuation: item.data.continuation }),
    }, item.data.expectedRevision)
    await monitor.refresh()
    writeJson(response, 200, await currentView(service))
  } catch (error) {
    if (error instanceof HttpAdmissionError) {
      writeJson(response, error.status, { error: error.message })
      return
    }
    writeJson(response, 400, { error: error instanceof Error ? error.message : 'Queue settings operation failed.' })
  }
}
