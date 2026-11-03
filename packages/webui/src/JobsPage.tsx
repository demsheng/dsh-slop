import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, IconPauseOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { duration } from './ChatJobs.tsx'
import { editJob, readJobs, runJobsAction, type JobAction, type JobEdit, type JobItem, type JobsView } from './chat-queue-client.ts'
import { useSlopUi } from './context.tsx'
import { JobDetail } from './JobDetail.tsx'
import { attentionLabel, folderName, isLive, jobDot, jobPriority, matchesJobFilter, matchesJobQuery, nextCheckLabel, shorten, stateLabel, type JobFilter, type JobGrouping } from './jobs-model.ts'
import { cx, formatRelative } from './ui.tsx'

const filters: readonly { key: JobFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'finished', label: 'Finished' },
  { key: 'all', label: 'All' },
]

interface Group { readonly key: string; readonly title: string; readonly items: readonly JobItem[] }

function Summary({ item, grouping, machine, now }: { item: JobItem; grouping: JobGrouping; machine: string; now: number }): ReactNode {
  const runtime = item.state === 'queued'
    ? item.createdAt === undefined ? undefined : `waiting ${formatRelative(item.createdAt, now).replace(' ago', '')}`
    : item.elapsedSeconds === undefined ? undefined : item.walltimeSeconds === undefined ? duration(item.elapsedSeconds) : `${duration(item.elapsedSeconds)} of ${duration(item.walltimeSeconds)}`
  const facts = [
    stateLabel(item),
    runtime,
    grouping === 'machine' ? undefined : machine,
    `${item.observerKind === 'process' ? 'PID' : item.observerKind} ${item.observerId}`,
    grouping === 'chat' ? undefined : folderName(item.cwd),
    ...item.tags,
  ].filter((fact, index, all): fact is string => fact !== undefined && all.indexOf(fact) === index)
  const attention = attentionLabel(item)
  return <span className="slop-jobs-summary">
    {attention === undefined ? null : <span className="slop-jobs-fact slop-jobs-warn">{attention}</span>}
    {facts.map((fact, index) => <span key={`${index}-${fact}`} className="slop-jobs-fact">{fact}</span>)}
  </span>
}

/** Every Queue item across Chats, with monitoring controls. Polling reads saved observations; only actions probe. */
export function JobsPage({ openChat }: { openChat: (sessionId: string) => void }): ReactNode {
  const { snapshot } = useSlopUi()
  const [view, setView] = useState<JobsView>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState<JobFilter>('active')
  const [query, setQuery] = useState('')
  const [grouping, setGrouping] = useState<JobGrouping>('machine')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [openId, setOpenId] = useState<string>()
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState<{ warn: boolean; text: string }>()
  const [now, setNow] = useState(Date.now)
  const generation = useRef(0)
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (message === undefined || message.warn) return
    const timer = setTimeout(() => setMessage(undefined), 4000)
    return () => clearTimeout(timer)
  }, [message])
  const adopt = useCallback((next: JobsView) => { setView(next); setError(undefined) }, [])
  const load = useCallback(async () => {
    const controller = lifetime.current
    if (controller === undefined) return
    const request = ++generation.current
    try {
      const next = await readJobs(controller.signal)
      if (!controller.signal.aborted && request === generation.current) adopt(next)
    } catch (err) { if (!controller.signal.aborted && request === generation.current) setError(err instanceof Error ? err.message : 'Queue unavailable.') }
  }, [adopt])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await load()
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 10_000)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [load])

  const machineName = useCallback((item: JobItem) => item.machineId === undefined ? 'Host'
    : snapshot?.machineConnections.find(row => row.machineId === item.machineId)?.machineLabel ?? item.machineId, [snapshot])
  const items = useMemo(() => [...view?.items ?? []].sort((a, b) => jobPriority[a.state] - jobPriority[b.state] || Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '')), [view])
  const visible = items.filter(item => matchesJobFilter(item, filter) && matchesJobQuery(item, query, machineName(item)))
  const groups: Group[] = useMemo(() => {
    if (grouping === 'none') return [{ key: 'all', title: '', items: visible }]
    const map = new Map<string, JobItem[]>()
    for (const item of visible) {
      const key = grouping === 'machine' ? item.machineId ?? 'local' : item.sessionId
      map.set(key, [...map.get(key) ?? [], item])
    }
    return [...map].map(([key, rows]) => ({ key, title: grouping === 'machine' ? machineName(rows[0]!) : folderName(rows[0]!.cwd), items: rows }))
      .sort((left, right) => left.title.localeCompare(right.title))
  }, [grouping, visible, machineName])
  const open = items.find(item => item.id === openId)

  const act = async (action: JobAction, ids: readonly string[]) => {
    const controller = lifetime.current
    if (controller === undefined || ids.length === 0) return
    setBusy(new Set(ids)); setMessage(undefined)
    generation.current++
    try {
      const next = await runJobsAction(action, ids, controller.signal)
      adopt(next)
      const verb = action === 'check' ? 'Checked' : action === 'pause' ? 'Paused checks for' : 'Resumed checks for'
      const done = ids.length - next.failures.length
      const first = next.failures[0]
      setMessage(first === undefined
        ? { warn: false, text: `${verb} ${done} ${done === 1 ? 'job' : 'jobs'}.` }
        : { warn: true, text: `${verb} ${done} of ${ids.length}. ${next.items.find(item => item.id === first.id)?.label ?? first.id}: ${shorten(first.error, 140)}${next.failures.length > 1 ? ` (+${next.failures.length - 1} more)` : ''}` })
    } catch (err) { setMessage({ warn: true, text: err instanceof Error ? err.message : 'The action failed.' }) }
    finally { if (!controller.signal.aborted) setBusy(new Set()) }
  }
  const edit = async (item: JobItem, change: JobEdit) => {
    const controller = lifetime.current
    if (controller === undefined) return
    setBusy(new Set([item.id]))
    generation.current++
    try { adopt(await editJob(item.id, item.revision, change, controller.signal)) }
    catch (err) { void load(); throw err }
    finally { if (!controller.signal.aborted) setBusy(new Set()) }
  }
  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(selected)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    setSelected(next)
  }
  const chosen = items.filter(item => selected.has(item.id))
  const chosenLive = chosen.filter(isLive)
  const liveUnpaused = items.filter(item => isLive(item) && !item.paused)

  return <section className={cx('slop-view slop-jobs-page', open !== undefined && 'slop-jobs-page-detail')}>
    <div className="slop-jobs-list-pane">
      <div className="slop-jobs-scroll">
        <div className="slop-jobs-content">
          <div className="slop-jobs-heading">
            <h1>Jobs</h1>
            <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} disabled={busy.size > 0 || liveUnpaused.length === 0} onClick={() => { void act('check', liveUnpaused.map(item => item.id)) }}>Check all</Button>
          </div>
          {chosen.length === 0 ? <div className="slop-jobs-filters">
            <div className="slop-jobs-tabs" role="tablist" aria-label="Filter jobs">
              {filters.map(({ key, label }) => <button type="button" role="tab" key={key} aria-selected={filter === key} className={cx('slop-jobs-tab', filter === key && 'slop-jobs-tab-active')} onClick={() => setFilter(key)}>
                {label}<span className="slop-jobs-count">{items.filter(item => matchesJobFilter(item, key)).length}</span>
              </button>)}
            </div>
            <label className="slop-jobs-grouping">Group by
              <select value={grouping} onChange={event => setGrouping(event.target.value as JobGrouping)}>
                <option value="machine">Machine</option><option value="chat">Chat</option><option value="none">None</option>
              </select>
            </label>
          </div> : <div className="slop-jobs-filters slop-jobs-bulk" role="toolbar" aria-label="Selected jobs">
            <span>{chosen.length} selected</span>
            <Button size="sm" disabled={busy.size > 0} onClick={() => { void act('check', chosen.map(item => item.id)) }}>Check now</Button>
            <Button size="sm" disabled={busy.size > 0 || !chosenLive.some(item => !item.paused)} onClick={() => { void act('pause', chosenLive.filter(item => !item.paused).map(item => item.id)) }}>Pause checks</Button>
            <Button size="sm" disabled={busy.size > 0 || !chosenLive.some(item => item.paused)} onClick={() => { void act('resume', chosenLive.filter(item => item.paused).map(item => item.id)) }}>Resume checks</Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>}
          <Input className="slop-jobs-search" icon={<IconSearchOutlineRegular size={16} />} type="search" placeholder="Search jobs, IDs, Machines or tags" aria-label="Search jobs" value={query} onChange={event => setQuery(event.target.value)} />
          {message === undefined ? null : <p className={cx('slop-jobs-message', message.warn && 'slop-jobs-warn')} role="status">
            <span>{message.text}</span><button type="button" onClick={() => setMessage(undefined)}>Dismiss</button>
          </p>}
          {error === undefined || view === undefined ? null : <p className="slop-jobs-message slop-jobs-warn">{error} Showing the last saved observations.</p>}
          {view === undefined ? <p className="slop-jobs-empty">{error ?? 'Loading jobs…'}</p>
            : visible.length === 0 ? <p className="slop-jobs-empty">{query.trim() !== '' ? 'No jobs match this search.' : filter === 'active' ? 'No active jobs. Jobs appear here after an Agent tracks a submission.' : filter === 'attention' ? 'Nothing needs attention.' : 'No jobs.'}</p>
            : groups.map(group => {
              const live = group.items.filter(item => isLive(item) && !item.paused)
              const all = group.items.every(item => selected.has(item.id))
              return <div key={group.key} className="slop-jobs-group">
                {grouping === 'none' ? null : <div className="slop-jobs-group-head">
                  <span className="slop-jobs-group-title">{group.title}</span>
                  <span className="slop-jobs-count">{group.items.length}</span>
                  <span className="slop-jobs-group-actions">
                    {grouping === 'chat' ? <button type="button" onClick={() => openChat(group.items[0]!.sessionId)}>Open Chat</button> : null}
                    {live.length < 2 ? null : <button type="button" disabled={busy.size > 0} onClick={() => { void act('check', live.map(item => item.id)) }}>Check {live.length}</button>}
                    <button type="button" aria-label={`${all ? 'Deselect' : 'Select'} jobs in ${group.title}`} onClick={() => toggle(group.items.map(item => item.id), !all)}>{all ? 'Deselect' : 'Select'}</button>
                  </span>
                </div>}
                <ul className="slop-jobs-rows">{group.items.map(item => {
                  const checked = selected.has(item.id)
                  return <li key={item.id} className={cx('slop-jobs-row', item.id === openId && 'slop-jobs-row-open', checked && 'slop-jobs-row-checked', !isLive(item) && 'slop-jobs-row-ended')} aria-busy={busy.has(item.id)}>
                    <span className="slop-jobs-glyph">
                      <StateDot state={jobDot(item)} />
                      <input type="checkbox" aria-label={`Select ${item.label}`} checked={checked} onChange={event => toggle([item.id], event.target.checked)} />
                    </span>
                    <button type="button" className="slop-jobs-row-main" aria-expanded={item.id === openId} onClick={() => setOpenId(item.id === openId ? undefined : item.id)}>
                      <span className="slop-jobs-title">{item.label}</span>
                      <Summary item={item} grouping={grouping} machine={machineName(item)} now={now} />
                    </button>
                    <span className="slop-jobs-trailing">
                      <span className="slop-jobs-when" title={item.nextCheckReason}>{isLive(item) ? nextCheckLabel(item, now) : formatRelative(item.observedAt ?? item.updatedAt, now)}</span>
                      <span className="slop-jobs-row-actions">
                        <button type="button" aria-label={`Check ${item.label} now`} title="Check now" disabled={busy.size > 0} onClick={() => { void act('check', [item.id]) }}><IconRefreshOutlineRegular size={16} /></button>
                        {isLive(item) ? <button type="button" aria-label={`${item.paused ? 'Resume' : 'Pause'} checks for ${item.label}`} title={item.paused ? 'Resume checks' : 'Pause checks'} disabled={busy.size > 0} onClick={() => { void act(item.paused ? 'resume' : 'pause', [item.id]) }}>{item.paused ? <IconPlayOutlineRegular size={16} /> : <IconPauseOutlineRegular size={16} />}</button> : null}
                      </span>
                    </span>
                  </li>
                })}</ul>
              </div>
            })}
        </div>
      </div>
    </div>
    {open === undefined ? null : <JobDetail key={open.id} item={open} machine={machineName(open)} now={now} busy={busy.size > 0}
      onClose={() => setOpenId(undefined)} onAction={action => act(action, [open.id])} onEdit={change => edit(open, change)} onOpenChat={() => openChat(open.sessionId)} />}
  </section>
}

/** Sidebar glyph: the same job-list mark as the composer summary. */
export function JobsIcon({ size }: { size: number }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 5.5h1m2 0h3M5 8h1m2 0h3M5 10.5h1m2 0h3" /></svg>
}
