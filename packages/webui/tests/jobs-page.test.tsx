// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobsPage } from '../src/JobsPage.tsx'
import { decodeJobHistory, decodeJobs, type JobItem } from '../src/chat-queue-client.ts'
import { attentionLabel, cancelCommand, matchesJobFilter, nextCheckLabel, timeline } from '../src/jobs-model.ts'
import { SlopUiProvider } from '../src/context.tsx'
import { createMockSlopClient } from '../src/mock.ts'
import { createSlopStore } from '../src/store.ts'

const boot = { csrfNonce: 'abcdefghijklmnopqrstuvwxyz012345', browserBootstrapPath: '/dsh-slop/browser-bootstrap', knowledgeSettingsBridgePath: '/dsh-slop/knowledge-settings', queueSettingsBridgePath: '/dsh-slop/queue-settings' }
const row = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id, label: `Job ${id}`, state, target: { kind: 'machine', machineId: 'nova' }, observerId: id, observerKind: 'slurm', sessionId: 'chat-a', cwd: '/work/HZO', revision: 3, tags: [],
  observedAt: new Date(Date.now() - 5000).toISOString(), nextCheckAt: new Date(Date.now() + 600_000).toISOString(), evidence: `${id} evidence`, ...extra,
})
const item = (extra: Record<string, unknown>): JobItem => decodeJobs({ schemaVersion: 1, items: [row('x', 'running', extra)] }).items[0]!

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(fetcher: ReturnType<typeof vi.fn>, openChat = vi.fn()) {
  vi.stubGlobal('__DSH_SLOP_BOOT__', boot)
  vi.stubGlobal('fetch', fetcher)
  const client = createMockSlopClient(); const store = createSlopStore(client)
  render(<SlopUiProvider client={client} store={store}><JobsPage openChat={openChat} /></SlopUiProvider>)
  return { store, openChat }
}

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('Jobs page', () => {
  it('lists active jobs by Machine, filters, searches and opens a job with its history', async () => {
    const fetcher = vi.fn(async (url: string) => url.includes('view=job&')
      ? reply({ schemaVersion: 1, id: 'r1', observations: [{ state: 'queued', observedAt: '2026-11-01T00:00:00Z', evidence: 'PENDING' }, { state: 'running', observedAt: '2026-11-01T01:00:00Z', evidence: 'RUNNING', phase: 'train' }] })
      : reply({ schemaVersion: 1, failures: [], items: [row('r1', 'running', { tags: ['HZO'] }), row('f1', 'failed'), row('q1', 'queued', { paused: true, nextCheckAt: undefined })] }))
    const { store, openChat } = mount(fetcher)
    expect(await screen.findByText('Job r1')).toBeTruthy()
    expect(screen.getByText('Job q1')).toBeTruthy()
    expect(screen.queryByText('Job f1')).toBeNull()
    expect(screen.getByText('Checks paused')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Needs attention/ }))
    expect(screen.getByText('Job f1')).toBeTruthy()
    expect(screen.queryByText('Job r1')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search jobs' }), { target: { value: 'hzo r1' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByText('Job r1'))
    const detail = screen.getByRole('complementary', { name: 'Job r1 details' })
    expect(within(detail).getByText('scancel r1')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: 'HZO' }))
    expect(openChat).toHaveBeenCalledWith('chat-a')
    fireEvent.click(within(detail).getByRole('tab', { name: 'History' }))
    expect(await within(detail).findByText('Running · train')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith('/dsh-slop/queue-settings?view=job&id=r1', expect.anything())
    store.destroy()
  })

  it('sends bulk check and pause for selected jobs and reports per-job failures', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT'
      ? reply({ schemaVersion: 1, failures: [{ id: 'b', error: 'AUTH_REQUIRED: Human authentication is required.' }], items: [row('a', 'running'), row('b', 'running')] })
      : reply({ schemaVersion: 1, failures: [], items: [row('a', 'running'), row('b', 'running')] }))
    const { store } = mount(fetcher)
    await screen.findByText('Job a')
    fireEvent.click(screen.getByRole('button', { name: 'Select jobs in nova' }))
    const bar = screen.getByRole('toolbar', { name: 'Selected jobs' })
    expect(within(bar).getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith('/dsh-slop/queue-settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ scope: 'jobs-action', action: 'check', ids: ['a', 'b'] }) })))
    expect(await screen.findByText(/Checked 1 of 2\. Job b: AUTH_REQUIRED/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected jobs' })).getByRole('button', { name: 'Pause checks' }))
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith('/dsh-slop/queue-settings', expect.objectContaining({ body: JSON.stringify({ scope: 'jobs-action', action: 'pause', ids: ['a', 'b'] }) })))
    store.destroy()
  })

  it('edits name, follow-up, interval and tags with the item revision', async () => {
    const fetcher = vi.fn(async () => reply({ schemaVersion: 1, failures: [], items: [row('a', 'running')] }))
    const { store } = mount(fetcher)
    fireEvent.click(await screen.findByText('Job a'))
    const detail = screen.getByRole('complementary', { name: 'Job a details' })
    const name = within(detail).getByRole('textbox', { name: 'Job name' })
    fireEvent.change(name, { target: { value: 'HZO iter 4' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.blur(name)
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/dsh-slop/queue-settings', expect.objectContaining({ body: JSON.stringify({ scope: 'jobs-edit', id: 'a', expectedRevision: 3, label: 'HZO iter 4' }) })))
    fireEvent.change(within(detail).getByRole('combobox'), { target: { value: '1800' } })
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/dsh-slop/queue-settings', expect.objectContaining({ body: JSON.stringify({ scope: 'jobs-edit', id: 'a', expectedRevision: 3, userIntervalSeconds: 1800 }) })))
    fireEvent.click(within(detail).getByRole('tab', { name: 'Continue in the Chat' }))
    fireEvent.change(within(detail).getByRole('textbox', { name: 'Next step' }), { target: { value: 'Plot RDF' } })
    fireEvent.click(within(detail).getByRole('button', { name: 'Save follow-up' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/dsh-slop/queue-settings', expect.objectContaining({ body: JSON.stringify({ scope: 'jobs-edit', id: 'a', expectedRevision: 3, purpose: 'continue', continuation: 'Plot RDF' }) })))
    fireEvent.change(within(detail).getByRole('textbox', { name: 'Tags' }), { target: { value: 'HZO, dpgen ,' } })
    fireEvent.click(within(detail).getByRole('button', { name: 'Save tags and notes' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/dsh-slop/queue-settings', expect.objectContaining({ body: JSON.stringify({ scope: 'jobs-edit', id: 'a', expectedRevision: 3, tags: ['HZO', 'dpgen'], notes: null }) })))
    store.destroy()
  })

  it('shows an empty state without active jobs', async () => {
    const { store } = mount(vi.fn(async () => reply({ schemaVersion: 1, items: [row('d1', 'completed')] })))
    expect(await screen.findByText(/No active jobs/)).toBeTruthy()
    store.destroy()
  })
})

describe('Jobs model', () => {
  it('names the most urgent problem and treats paused live jobs as needing attention', () => {
    expect(attentionLabel(item({ checkError: 'AUTH_REQUIRED: Human authentication is required.' }))).toBe('Machine needs sign-in')
    expect(attentionLabel(item({ checkError: 'timeout' }))).toBe('Checks failing')
    expect(attentionLabel(item({ paused: true }))).toBe('Checks paused')
    expect(attentionLabel(item({ deliveryError: 'gone', paused: true }))).toBe('Could not reach its Chat')
    expect(matchesJobFilter(item({ paused: true }), 'attention')).toBe(true)
    expect(matchesJobFilter(item({}), 'attention')).toBe(false)
  })

  it('formats next checks without a 60-minute remainder', () => {
    const now = Date.parse('2026-11-03T00:00:00Z')
    expect(nextCheckLabel(item({ nextCheckAt: new Date(now + 5 * 3600_000 + 59 * 60_000 + 50_000).toISOString() }), now)).toBe('in 6h 0m')
    expect(nextCheckLabel(item({ nextCheckAt: new Date(now + 3590_000).toISOString() }), now)).toBe('in 1h 0m')
    expect(nextCheckLabel(item({ nextCheckAt: new Date(now - 1000).toISOString() }), now)).toBe('Due')
    expect(nextCheckLabel(item({ paused: true }), now)).toBe('Paused')
  })

  it('collapses repeated observations into state changes, newest first', () => {
    const rows = decodeJobHistory({ schemaVersion: 1, id: 'x', observations: [
      { state: 'running', observedAt: '2026-11-01T03:00:00Z', evidence: 'c' },
      { state: 'running', observedAt: '2026-11-01T02:00:00Z', evidence: 'b' },
      { state: 'queued', observedAt: '2026-11-01T00:00:00Z', evidence: 'a' },
      { state: 'running', observedAt: '2026-11-01T01:00:00Z', evidence: 'r' },
    ] }, 'x')
    expect(timeline(rows).map(observation => observation.evidence)).toEqual(['c', 'r', 'a'])
  })

  it('offers the scheduler cancel command without running it', () => {
    expect(cancelCommand({ observerKind: 'slurm', observerId: '17' })).toBe('scancel 17')
    expect(cancelCommand({ observerKind: 'pbs', observerId: '9.pbs' })).toBe('qdel 9.pbs')
    expect(cancelCommand({ observerKind: 'process', observerId: '4242' })).toBe('kill 4242')
  })

  it('rejects malformed Jobs responses', () => {
    expect(() => decodeJobs({ schemaVersion: 1, items: [{ id: 'x' }] })).toThrow('Invalid Jobs item.')
    expect(() => decodeJobs({ schemaVersion: 2, items: [] })).toThrow('Invalid Jobs response.')
    expect(() => decodeJobHistory({ schemaVersion: 1, id: 'other', observations: [] }, 'x')).toThrow('Invalid job history.')
  })
})
