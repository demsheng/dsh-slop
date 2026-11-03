import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconCopyOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { duration } from './ChatJobs.tsx'
import { readJobHistory, type JobAction, type JobEdit, type JobItem, type JobObservation } from './chat-queue-client.ts'
import { attentionLabel, cancelCommand, folderName, isLive, jobDot, nextCheckLabel, shorten, stateLabel, timeline } from './jobs-model.ts'
import { cx, formatDate, formatRelative } from './ui.tsx'

const intervals = [[300, 'Every 5 minutes'], [900, 'Every 15 minutes'], [1800, 'Every 30 minutes'], [3600, 'Every hour'], [10800, 'Every 3 hours'], [21600, 'Every 6 hours']] as const

interface Props {
  readonly item: JobItem
  readonly machine: string
  readonly now: number
  readonly busy: boolean
  onClose(): void
  onAction(action: JobAction): Promise<void>
  onEdit(change: JobEdit): Promise<void>
  onOpenChat(): void
}

function History({ id, observedAt }: { id: string; observedAt: string | undefined }): ReactNode {
  const [rows, setRows] = useState<JobObservation[]>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    readJobHistory(id, controller.signal).then(next => { setRows(timeline(next)); setError(undefined) }, (failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'History unavailable.') })
    return () => controller.abort()
  }, [id, observedAt])
  if (error !== undefined) return <p className="slop-jobs-quiet">{error}</p>
  if (rows === undefined) return <p className="slop-jobs-quiet">Loading…</p>
  if (rows.length === 0) return <p className="slop-jobs-quiet">Not checked yet.</p>
  return <ol className="slop-jobs-history">{rows.map(row => {
    const key = `${row.observedAt}-${row.state}`
    return <li key={key}>
      <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? undefined : key)}>
        <StateDot state={row.state === 'failed' ? 'error' : row.state === 'completed' ? 'done' : row.state === 'running' ? 'ongoing' : row.state === 'unknown' ? 'warning' : 'idle'} />
        <span className="slop-jobs-history-text"><span>{stateLabel(row)}{row.phase === undefined ? '' : ` · ${row.phase}`}</span>
          <span className="slop-jobs-quiet">{formatDate(row.observedAt)}{row.elapsedSeconds === undefined ? '' : ` · ${duration(row.elapsedSeconds)} in`}{row.source === 'code' || row.source === undefined ? '' : ` · ${row.source}`}</span></span>
      </button>
      {open === key ? <pre>{row.evidence}</pre> : null}
    </li>
  })}</ol>
}

export function JobDetail({ item, machine, now, busy, onClose, onAction, onEdit, onOpenChat }: Props): ReactNode {
  const [tab, setTab] = useState<'overview' | 'history'>('overview')
  const [label, setLabel] = useState(item.label)
  const [purpose, setPurpose] = useState<'monitor' | 'continue'>(item.purpose === 'continue' ? 'continue' : 'monitor')
  const [continuation, setContinuation] = useState(item.continuation ?? '')
  const [tags, setTags] = useState(item.tags.join(', '))
  const [notes, setNotes] = useState(item.notes ?? '')
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setLabel(item.label); setPurpose(item.purpose === 'continue' ? 'continue' : 'monitor'); setContinuation(item.continuation ?? '')
    setTags(item.tags.join(', ')); setNotes(item.notes ?? '')
  }, [item.revision])

  const save = (change: JobEdit) => {
    setError(undefined)
    onEdit(change).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : 'Could not save.') })
  }
  const commitLabel = () => { if (label.trim() !== '' && label.trim() !== item.label) save({ label: label.trim() }); else setLabel(item.label) }
  const tagList = tags.split(',').map(tag => tag.trim()).filter(Boolean)
  const followChanged = purpose !== (item.purpose ?? 'monitor') || (purpose === 'continue' && continuation.trim() !== (item.continuation ?? ''))
  const organizeChanged = tagList.join(',') !== item.tags.join(',') || notes.trim() !== (item.notes ?? '')
  const live = isLive(item)
  const interval = item.userIntervalSeconds
  const attention = attentionLabel(item)
  const facts: readonly (readonly [string, ReactNode])[] = [
    ['Machine', machine],
    ['Scheduler ID', <code key="id">{item.observerKind === 'process' ? 'PID' : item.observerKind} {item.observerId}</code>],
    ['Chat', <button key="chat" type="button" className="slop-jobs-link" title={item.cwd} onClick={onOpenChat}>{folderName(item.cwd)}</button>],
    ['Started', item.startedAt === undefined ? (item.state === 'queued' ? 'Not yet' : '—') : formatDate(item.startedAt)],
    ['Runtime', item.elapsedSeconds === undefined ? '—' : `${duration(item.elapsedSeconds)}${item.walltimeSeconds === undefined ? '' : ` of ${duration(item.walltimeSeconds)} walltime`}`],
    ...(item.phase === undefined ? [] : [['Phase', item.phase] as const]),
    ['Last checked', <span key="seen" title={formatDate(item.observedAt)}>{formatRelative(item.observedAt, now)}</span>],
    ...(live ? [['Next check', <span key="next" title={item.nextCheckReason}>{nextCheckLabel(item, now)}</span>] as const] : []),
  ]

  return <aside className="slop-jobs-detail" aria-label={`${item.label} details`}>
    <div className="slop-jobs-detail-bar">
      <div className="slop-jobs-detail-tabs" role="tablist">
        {(['overview', 'history'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'overview' ? 'Overview' : 'History'}</button>)}
      </div>
      <div className="slop-jobs-detail-actions">
        <button type="button" aria-label="Check now" title="Check now" disabled={busy} onClick={() => { void onAction('check') }}><IconRefreshOutlineRegular size={16} /></button>
        {live ? <button type="button" aria-label={item.paused ? 'Resume checks' : 'Pause checks'} title={item.paused ? 'Resume checks' : 'Pause checks'} disabled={busy} onClick={() => { void onAction(item.paused ? 'resume' : 'pause') }}>{item.paused ? <IconPlayOutlineRegular size={16} /> : <IconPauseOutlineRegular size={16} />}</button> : null}
        <button type="button" aria-label="Close details" title="Close" onClick={onClose}><IconCloseOutlineRegular size={16} /></button>
      </div>
    </div>
    <div className="slop-jobs-detail-scroll">
      <input className="slop-jobs-name" aria-label="Job name" value={label} maxLength={256} onFocus={event => event.currentTarget.select()} onChange={event => setLabel(event.target.value)}
        onBlur={commitLabel} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setLabel(item.label); event.currentTarget.blur() } }} />
      <p className="slop-jobs-state"><StateDot state={jobDot(item)} />{stateLabel(item)}{attention === undefined ? null : <span className="slop-jobs-warn"> · {attention}</span>}</p>
      {item.checkError === undefined || !live ? null : <p className="slop-jobs-note slop-jobs-warn" title={item.checkError}>
        {item.consecutiveFailures > 1 ? `${item.consecutiveFailures} checks in a row failed: ` : 'Last check failed: '}{shorten(item.checkError, 200)}
        {/AUTH_REQUIRED|authentication/i.test(item.checkError) ? ` Reconnect ${machine} from its Chat, then check again.` : ''}</p>}
      {item.paused ? <p className="slop-jobs-note">Queue is not checking this job and will not notify its Chat until you resume or check it.</p> : null}
      {item.deliveryError === undefined ? null : <p className="slop-jobs-note slop-jobs-warn">Could not notify the Chat: {shorten(item.deliveryError, 200)}</p>}
      {error === undefined ? null : <p className="slop-jobs-note slop-jobs-warn" role="alert">{error}</p>}

      {tab === 'history' ? <History id={item.id} observedAt={item.observedAt} /> : <>
        <dl className="slop-jobs-facts">{facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>

        {live ? <section className="slop-jobs-section">
          <h2>Monitoring</h2>
          <label className="slop-jobs-field"><span>Check</span>
            <select value={interval === undefined ? '' : String(interval)} disabled={busy} onChange={event => save({ userIntervalSeconds: event.target.value === '' ? null : Number(event.target.value) })}>
              <option value="">Automatically</option>
              {intervals.map(([seconds, text]) => <option key={seconds} value={seconds}>{text}</option>)}
              {interval === undefined || intervals.some(([seconds]) => seconds === interval) ? null : <option value={interval}>Every {duration(interval)}</option>}
            </select>
          </label>
        </section> : null}

        <section className="slop-jobs-section">
          <h2>When it finishes</h2>
          <SegmentedControl id={`job-${item.id}-purpose`} label="When it finishes" value={purpose} disabled={busy}
            options={[{ value: 'monitor', label: 'Notify the Chat' }, { value: 'continue', label: 'Continue in the Chat' }]} onChange={setPurpose} />
          {purpose === 'continue' ? <>
            <textarea className="slop-jobs-textarea" aria-label="Next step" rows={3} maxLength={4096} placeholder="What the Chat should do next, and where the results are" value={continuation} onChange={event => setContinuation(event.target.value)} />
            <p className="slop-jobs-quiet">The Chat wakes when the job ends and does this step. Saving it here approves that step.</p>
          </> : null}
          {followChanged ? <div className="slop-jobs-save"><Button size="sm" variant="primary" aria-label="Save follow-up" disabled={busy || (purpose === 'continue' && continuation.trim() === '')} onClick={() => save(purpose === 'continue' ? { purpose, continuation: continuation.trim() } : { purpose })}>Save</Button></div> : null}
        </section>

        <section className="slop-jobs-section">
          <h2>Tags and notes</h2>
          <input className="slop-jobs-input" aria-label="Tags" placeholder="Tags, separated by commas" value={tags} onChange={event => setTags(event.target.value)} />
          <textarea className="slop-jobs-textarea" aria-label="Notes" rows={2} maxLength={4096} placeholder="Notes" value={notes} onChange={event => setNotes(event.target.value)} />
          {organizeChanged ? <div className="slop-jobs-save"><Button size="sm" variant="primary" aria-label="Save tags and notes" disabled={busy} onClick={() => save({ tags: tagList, notes: notes.trim() === '' ? null : notes.trim() })}>Save</Button></div> : null}
        </section>

        {live ? <section className="slop-jobs-section">
          <h2>Stop the job</h2>
          <p className="slop-jobs-quiet">Queue only watches jobs. Run this on {machine}, or ask the Chat.</p>
          <div className={cx('slop-jobs-command')}><code>{cancelCommand(item)}</code>
            <button type="button" aria-label="Copy command" title={copied ? 'Copied' : 'Copy'} onClick={() => { void navigator.clipboard?.writeText(cancelCommand(item)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}><IconCopyOutlineRegular size={16} /></button></div>
        </section> : null}

        {item.evidence === undefined ? null : <section className="slop-jobs-section">
          <h2>Latest output</h2>
          <pre className="slop-jobs-evidence">{item.evidence}</pre>
        </section>}
      </>}
    </div>
  </aside>
}
