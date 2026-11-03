import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultQueueSettings, queueItemSchema } from '@dsh-slop/queue'
import { QUEUE_SETTINGS_BRIDGE_PATH, serveQueueSettingsBridge } from '../src/queue-settings-bridge.ts'

const authority = 'host.example.net:3080'
const nonce = 'abcdefghijklmnopqrstuvwxyz012345'
const now = Date.parse('2026-09-03T12:00:00.000Z')
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now) })
afterEach(() => { vi.restoreAllMocks() })

function request(method: 'GET' | 'PUT', body?: unknown): IncomingMessage {
  const input = new Readable({ read() {} }) as IncomingMessage
  input.method = method
  input.url = QUEUE_SETTINGS_BRIDGE_PATH
  input.headers = {
    host: authority,
    origin: `https://${authority}`,
    'sec-fetch-site': 'same-origin',
    'x-dsh-slop-csrf': nonce,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }
  input.socket = { remoteAddress: '127.0.0.1', localPort: 3080 } as Socket
  if (body !== undefined) queueMicrotask(() => { input.push(JSON.stringify(body)); input.push(null) })
  return input
}

function response(): { readonly value: ServerResponse; readonly read: () => { readonly status?: number; readonly body: unknown } } {
  let status: number | undefined
  let body: unknown
  return {
    value: { writeHead(next: number) { status = next }, end(value: string) { body = JSON.parse(value) as unknown } } as unknown as ServerResponse,
    read: () => ({ ...(status === undefined ? {} : { status }), body }),
  }
}

function backend() {
  const settings = defaultQueueSettings(new Date('2026-09-03T12:00:00.000Z'))
  const item = queueItemSchema.parse({
    id: 'job-1', label: 'Simulation', tags: [], target: { kind: 'machine', machineId: 'nova' }, observer: { kind: 'slurm', jobId: '123' }, state: 'running', monitoring: {},
    attention: { primary: { sessionId: 'chat', cwd: '/work', agentPreset: 'code' }, primaryDelivery: 'notify', primaryConditions: ['any-state-change'], subscriptions: [] },
    revision: 1, createdAt: settings.updatedAt, updatedAt: settings.updatedAt, nextCheckAt: '2026-09-03T12:05:00.000Z', consecutiveUnchangedChecks: 1, consecutiveFailures: 1,
    lastObservation: { queueItemId: 'job-1', state: 'running', observedAt: '2026-09-03T12:01:00.000Z', evidence: 'running', source: 'code' },
    lastCheckError: { at: '2026-09-03T12:02:00.000Z', message: 'probe timed out' },
  })
  return {
    settings: vi.fn(async () => settings),
    updateSettings: vi.fn(async () => settings),
    list: vi.fn(async () => [item]),
    deliveries: vi.fn(async () => []),
    update: vi.fn(async () => item),
    probeNow: vi.fn(async () => item),
    observations: vi.fn(async () => [
      { queueItemId: item.id, state: 'queued', observedAt: '2026-09-03T11:00:00.000Z', evidence: 'PENDING', source: 'code' },
      { queueItemId: item.id, state: 'running', observedAt: '2026-09-03T12:01:00.000Z', evidence: 'x'.repeat(5_000), source: 'code' },
    ]),
  }
}

describe('Queue settings bridge', () => {
  it('limits settings to 14 days of updates without deleting or hiding the Chat history', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    const cutoff = now - 14 * 24 * 60 * 60 * 1_000
    service.list.mockResolvedValue([
      { ...base, id: queueItemSchema.shape.id.parse('old'), state: 'completed', updatedAt: new Date(cutoff - 1).toISOString() },
      { ...base, id: queueItemSchema.shape.id.parse('boundary'), updatedAt: new Date(cutoff).toISOString() },
      { ...base, createdAt: new Date(cutoff - 30 * 86400000).toISOString() },
    ])
    const output = response()
    const monitor = { refresh: vi.fn(async () => {}) }
    await serveQueueSettingsBridge(request('GET'), output.value, nonce, service, monitor, [authority])
    expect(output.read()).toMatchObject({ status: 200, body: { items: [
      { id: 'job-1', observerId: '123', updatedAt: base.updatedAt },
      { id: 'boundary' },
    ] } })
    const chat = request('GET'); chat.url += '?view=chat&sessionId=chat'
    const chatOutput = response()
    await serveQueueSettingsBridge(chat, chatOutput.value, nonce, service, monitor, [authority])
    expect(chatOutput.read()).toMatchObject({ body: { items: [{ id: 'old' }, { id: 'boundary' }, { id: 'job-1' }] } })
    expect(service.update).not.toHaveBeenCalled()
    expect(service.probeNow).not.toHaveBeenCalled()
    expect(monitor.refresh).not.toHaveBeenCalled()
  })
  it('checks only an owned item on an explicit refresh', async () => {
    const service = backend()
    const monitor = { refresh: vi.fn(async () => {}) }
    const output = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'chat-refresh', sessionId: 'chat', id: 'job-1' }), output.value, nonce, service, monitor, [authority])
    expect(service.probeNow).toHaveBeenCalledExactlyOnceWith('job-1')
    expect(monitor.refresh).toHaveBeenCalledOnce()
    expect(output.read()).toMatchObject({ status: 200, body: { sessionId: 'chat', items: [{ id: 'job-1' }] } })
  })

  it.each(['unrelated', 'missing-nonce', 'foreign-origin'])('rejects unauthorized refresh: %s', async variant => {
    const service = backend()
    const req = request('PUT', { scope: 'chat-refresh', sessionId: variant === 'unrelated' ? 'other' : 'chat', id: 'job-1' })
    if (variant === 'missing-nonce') delete req.headers['x-dsh-slop-csrf']
    if (variant === 'foreign-origin') req.headers.origin = 'https://untrusted.example'
    const output = response()
    await serveQueueSettingsBridge(req, output.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(variant === 'unrelated' ? 404 : 403)
    expect(service.probeNow).not.toHaveBeenCalled()
  })
  it('limits the Chat view to owned and explicitly subscribed items without probing', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    service.list.mockResolvedValue([
      base,
      { ...base, id: queueItemSchema.shape.id.parse('subscribed'), attention: { ...base.attention, primary: { ...base.attention.primary, sessionId: 'other' as typeof base.attention.primary.sessionId }, subscriptions: [{ target: base.attention.primary, delivery: 'notify', conditions: ['failed'] }] } },
      { ...base, id: queueItemSchema.shape.id.parse('unrelated'), attention: { ...base.attention, primary: { ...base.attention.primary, sessionId: 'other' as typeof base.attention.primary.sessionId } } },
    ])
    const req = request('GET')
    req.url += '?view=chat&sessionId=chat'
    const output = response()
    const monitor = { refresh: vi.fn(async () => {}) }
    await serveQueueSettingsBridge(req, output.value, nonce, service, monitor, [authority])
    expect(output.read()).toMatchObject({ status: 200, body: { sessionId: 'chat', items: [
      { id: 'job-1', relation: 'owned', observerId: '123', state: 'running', checkError: 'probe timed out' },
      { id: 'subscribed', relation: 'subscribed' },
    ] } })
    expect(monitor.refresh).not.toHaveBeenCalled()
  })

  it.each(['?view=chat', '?view=chat&sessionId=chat&sessionId=other', '?view=chat&sessionId=chat&extra=x'])('rejects invalid Chat selectors %s', async query => {
    const req = request('GET'); req.url += query
    const output = response()
    await serveQueueSettingsBridge(req, output.value, nonce, backend(), { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(400)
  })

  it('requires the nonce for the read-only Chat view', async () => {
    const req = request('GET'); req.url += '?view=chat&sessionId=chat'; delete req.headers['x-dsh-slop-csrf']
    const output = response()
    await serveQueueSettingsBridge(req, output.value, nonce, backend(), { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(403)
  })

  it('lists active jobs across Chats and only last-week terminal jobs without probing', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    const week = now - 7 * 24 * 60 * 60 * 1_000
    service.list.mockResolvedValue([
      { ...base, id: queueItemSchema.shape.id.parse('old-done'), state: 'completed', updatedAt: new Date(week - 1).toISOString() },
      { ...base, id: queueItemSchema.shape.id.parse('old-running'), updatedAt: new Date(week - 86400000).toISOString(), attention: { ...base.attention, primary: { ...base.attention.primary, sessionId: 'other' } } },
      { ...base, id: queueItemSchema.shape.id.parse('recent-failed'), state: 'failed', updatedAt: new Date(week + 1).toISOString() },
    ])
    const req = request('GET'); req.url += '?view=jobs'
    const output = response()
    const monitor = { refresh: vi.fn(async () => {}) }
    await serveQueueSettingsBridge(req, output.value, nonce, service, monitor, [authority])
    expect(output.read()).toMatchObject({ status: 200, body: { schemaVersion: 1, items: [
      { id: 'recent-failed', state: 'failed', sessionId: 'chat' },
      { id: 'old-running', state: 'running', sessionId: 'other', observerKind: 'slurm', observerId: '123', checkError: 'probe timed out' },
    ] } })
    expect((output.read().body as { items: unknown[] }).items).toHaveLength(2)
    expect(service.probeNow).not.toHaveBeenCalled()
    expect(monitor.refresh).not.toHaveBeenCalled()
  })

  it('checks several jobs and reports per-item failures without stopping', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    service.probeNow.mockResolvedValue({ ...base, lastCheckError: undefined })
    const monitor = { refresh: vi.fn(async () => {}) }
    const output = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-action', action: 'check', ids: ['job-1', 'nope', 'job-1'] }), output.value, nonce, service, monitor, [authority])
    expect(output.read()).toMatchObject({ status: 200, body: { failures: [{ id: 'nope', error: 'Queue item not found' }], items: [{ id: 'job-1' }] } })
    expect(service.probeNow).toHaveBeenCalledTimes(1)
    expect(monitor.refresh).toHaveBeenCalledTimes(1)
  })

  it('reports a check whose probe recorded a new error as failed', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    service.probeNow.mockResolvedValue({ ...base, lastCheckError: { at: new Date(now).toISOString(), message: 'AUTH_REQUIRED: Human authentication is required.' } })
    const output = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-action', action: 'check', ids: ['job-1'] }), output.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read()).toMatchObject({ body: { failures: [{ id: 'job-1', error: 'AUTH_REQUIRED: Human authentication is required.' }] } })
    service.probeNow.mockResolvedValue({ ...base, lastCheckError: { at: new Date(now - 60_000).toISOString(), message: 'old' } })
    const stale = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-action', action: 'check', ids: ['job-1'] }), stale.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(stale.read()).toMatchObject({ body: { failures: [] } })
  })

  it('pauses by clearing the next check, resumes by scheduling it now, and refuses finished jobs', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    const monitor = { refresh: vi.fn(async () => {}) }
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-action', action: 'pause', ids: ['job-1'] }), response().value, nonce, service, monitor, [authority])
    expect(service.update).toHaveBeenLastCalledWith('job-1', { nextCheckAt: null }, base.revision)
    service.list.mockResolvedValue([{ ...base, nextCheckAt: undefined }])
    const paused = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-action', action: 'resume', ids: ['job-1'] }), paused.value, nonce, service, monitor, [authority])
    expect(service.update).toHaveBeenLastCalledWith('job-1', { nextCheckAt: new Date(now).toISOString() }, base.revision)
    expect(paused.read()).toMatchObject({ body: { items: [{ id: 'job-1', paused: true }] } })
    service.list.mockResolvedValue([{ ...base, state: 'completed', nextCheckAt: undefined }])
    const done = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-action', action: 'pause', ids: ['job-1'] }), done.value, nonce, service, monitor, [authority])
    expect(done.read()).toMatchObject({ body: { failures: [{ id: 'job-1', error: 'Finished jobs have no scheduled checks' }], items: [{ paused: false }] } })
    expect(service.update).toHaveBeenCalledTimes(2)
  })

  it('edits label, tags, notes, purpose and interval with the expected revision', async () => {
    const service = backend()
    const output = response()
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-edit', id: 'job-1', expectedRevision: 1, label: ' HZO iter3 ', tags: ['HZO'], notes: '', purpose: 'continue', continuation: 'Run analysis.py on iter.000003', userIntervalSeconds: 600 }), output.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(200)
    expect(service.update).toHaveBeenCalledWith('job-1', { label: 'HZO iter3', tags: ['HZO'], notes: null, purpose: 'continue', continuation: 'Run analysis.py on iter.000003', monitoring: { userIntervalSeconds: 600 } }, 1)
  })

  it('keeps a paused job paused when its interval changes', async () => {
    const service = backend()
    const [base] = await service.list()
    if (base === undefined) throw new Error('fixture missing')
    service.list.mockResolvedValue([{ ...base, nextCheckAt: undefined }])
    await serveQueueSettingsBridge(request('PUT', { scope: 'jobs-edit', id: 'job-1', expectedRevision: 1, userIntervalSeconds: 1800 }), response().value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(service.update).toHaveBeenCalledWith('job-1', { monitoring: { userIntervalSeconds: 1800 }, nextCheckAt: null }, 1)
  })

  it.each([
    { scope: 'jobs-action', action: 'cancel', ids: ['job-1'] },
    { scope: 'jobs-action', action: 'check', ids: [] },
    { scope: 'jobs-action', action: 'check', ids: Array.from({ length: 51 }, (_, index) => `j${index}`) },
    { scope: 'jobs-edit', id: 'job-1', expectedRevision: 1, userIntervalSeconds: 30 },
    { scope: 'jobs-edit', id: 'job-1', expectedRevision: 1, state: 'completed' },
  ])('rejects unsupported Jobs requests %#', async body => {
    const service = backend()
    const output = response()
    await serveQueueSettingsBridge(request('PUT', body), output.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(400)
    expect(service.probeNow).not.toHaveBeenCalled()
    expect(service.update).not.toHaveBeenCalled()
  })

  it('returns bounded newest-first observation history without probing', async () => {
    const service = backend()
    const req = request('GET'); req.url += '?view=job&id=job-1'
    const output = response()
    await serveQueueSettingsBridge(req, output.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    const body = output.read().body as { observations: { state: string; evidence: string }[] }
    expect(body.observations.map(row => row.state)).toEqual(['running', 'queued'])
    expect(body.observations[0]?.evidence).toHaveLength(2_000)
    expect(service.probeNow).not.toHaveBeenCalled()
    const missing = request('GET'); missing.url += '?view=job&id=nope'
    const missingOutput = response()
    await serveQueueSettingsBridge(missing, missingOutput.value, nonce, service, { refresh: vi.fn(async () => {}) }, [authority])
    expect(missingOutput.read().status).toBe(404)
  })

  it.each(['?view=jobs&x=1', '?view=jobs&sessionId=chat', '?view=job', '?view=job&id=job-1&x=1'])('rejects extra Jobs selectors %s', async query => {
    const req = request('GET'); req.url += query
    const output = response()
    await serveQueueSettingsBridge(req, output.value, nonce, backend(), { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(400)
  })

  it('requires the nonce for the Jobs view', async () => {
    const req = request('GET'); req.url += '?view=jobs'; delete req.headers['x-dsh-slop-csrf']
    const output = response()
    await serveQueueSettingsBridge(req, output.value, nonce, backend(), { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read().status).toBe(403)
  })

  it('returns effective cadence and per-item scheduling provenance', async () => {
    const output = response()
    await serveQueueSettingsBridge(request('GET'), output.value, nonce, backend(), { refresh: vi.fn(async () => {}) }, [authority])
    expect(output.read()).toMatchObject({
      status: 200,
      body: {
        schemaVersion: 1,
        settings: { profile: 'normal', initialCheckSeconds: 60, stableMinimumSeconds: 300, defaultDelivery: 'notify' },
        items: [{ id: 'job-1', intervalSource: 'global', lastCheckAt: '2026-09-03T12:02:00.000Z', lastCheckError: 'probe timed out', nextCheckReason: 'probe retry 1 of 4' }],
      },
    })
  })

  it('updates global settings and refreshes the live monitor timer', async () => {
    const service = backend()
    const monitor = { refresh: vi.fn(async () => {}) }
    const output = response()
    await serveQueueSettingsBridge(request('PUT', {
      scope: 'global', expectedRevision: 1, patch: { profile: 'custom', stableMinimumSeconds: 600 },
    }), output.value, nonce, service, monitor, [authority])
    expect(service.updateSettings).toHaveBeenCalledWith({ profile: 'custom', stableMinimumSeconds: 600 }, 1)
    expect(monitor.refresh).toHaveBeenCalledOnce()
    expect(output.read().status).toBe(200)
  })
})
