import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Checkbox, ErrorState, LoadingState, Notice } from './ui.tsx'

export interface MachineKeepAliveView { readonly enabled: boolean; readonly revision: number; readonly writable: boolean }

export interface MachineKeepAliveSource {
  load(): Promise<MachineKeepAliveView>
  save(enabled: boolean, expectedRevision: number): Promise<MachineKeepAliveView>
}

export const MACHINE_KEEPALIVE_SCOPE = 'For a Host that runs for days. Every 30 minutes the Host runs a no-op command through each SSH connection that is already authenticated, so idle connections do not expire and 2FA Machines are not asked to sign in again. It never signs in for you: after a network drop, sleep or Host restart, reconnect as usual.'

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The connection setting is unavailable.'
}

/** Opt-in renewal of authenticated SSH connections for long-running deployments. */
export function MachineKeepAlive({ source }: { source: MachineKeepAliveSource }): ReactNode {
  const [view, setView] = useState<MachineKeepAliveView>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const load = useCallback(() => {
    setError(undefined)
    source.load().then(setView, (failure: unknown) => { setError(message(failure)) })
  }, [source])
  useEffect(load, [load])
  const save = (enabled: boolean): void => {
    if (view === undefined) return
    setSaving(true)
    setError(undefined)
    source.save(enabled, view.revision).then(setView, (failure: unknown) => { setError(message(failure)) }).finally(() => { setSaving(false) })
  }
  return <fieldset className="slop-fallback-model">
    <legend>Long-running Host</legend>
    {error !== undefined && view === undefined ? <ErrorState error={error} onRetry={load} /> : null}
    {view === undefined && error === undefined ? <LoadingState label="Loading the connection setting" /> : null}
    {view === undefined ? null : <>
      <Checkbox label="Keep SSH connections alive" checked={view.enabled} onChange={save} disabled={saving || !view.writable} />
      <p className="slop-section-description">{MACHINE_KEEPALIVE_SCOPE}</p>
      {view.writable ? null : <Notice tone="warning">This profile does not accept setting changes.</Notice>}
      {error === undefined ? null : <Notice tone="danger">{error}</Notice>}
    </>}
  </fieldset>
}
