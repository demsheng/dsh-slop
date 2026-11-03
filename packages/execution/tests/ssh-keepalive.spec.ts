import { describe, expect, it, vi } from 'vitest'
import { renewReadyConnections } from '../src/ssh-keepalive.ts'

function broker(states: Record<string, string>, runFails: string[] = []) {
  const runs: string[] = []
  const leases = new Map<string, string>()
  return {
    runs,
    readyMachineIds: vi.fn(() => Object.keys(states) as never[]),
    reconcileStatus: vi.fn(async (id: string) => ({ state: states[id] })) as never,
    connect: vi.fn(async (id: string) => { const lease = `lease-${id}`; leases.set(lease, id); return { id: lease } }) as never,
    run: vi.fn(async (lease: string, argv: string[]) => {
      const id = leases.get(lease)!
      if (runFails.includes(id)) throw new Error('master gone')
      runs.push(`${id}:${argv.join(' ')}`)
      return { exitCode: 0 }
    }) as never,
    release: vi.fn(async () => {}) as never,
  }
}

describe('SSH keepalive', () => {
  it('runs a no-op only through masters still ready after a socket check and releases each lease', async () => {
    const fake = broker({ nova: 'ready', anvil: 'auth-required' })
    await renewReadyConnections(fake)
    expect(fake.runs).toEqual(['nova:true'])
    expect(fake.connect).toHaveBeenCalledTimes(1)
    expect(fake.release).toHaveBeenCalledTimes(1)
  })

  it('continues past a failing Machine and never throws', async () => {
    const fake = broker({ nova: 'ready', anvil: 'ready' }, ['nova'])
    await expect(renewReadyConnections(fake)).resolves.toBeUndefined()
    expect(fake.runs).toEqual(['anvil:true'])
    expect(fake.release).toHaveBeenCalledTimes(2)
  })

  it('stops when the Host closes', async () => {
    const fake = broker({ nova: 'ready' })
    const controller = new AbortController(); controller.abort()
    await renewReadyConnections(fake, controller.signal)
    expect(fake.reconcileStatus).not.toHaveBeenCalled()
  })
})
