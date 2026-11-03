// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MachineKeepAlive } from '../src/MachineKeepAlive.tsx'
import { createMachineKeepAliveSource } from '../src/client/machine-keepalive-source.ts'

afterEach(cleanup)

describe('Machine keepalive setting', () => {
  it('reads and writes keepConnectionsAlive on the slop-machine namespace with its revision', async () => {
    const remote = {
      describe: vi.fn(async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: 'slop-machine', revision: 4, value: { keepConnectionsAlive: false } }] } })),
      update: vi.fn(async (_ns: string, patch: Record<string, unknown>) => ({ ok: true, value: { ns: 'slop-machine', revision: 5, value: patch } })),
    }
    render(<MachineKeepAlive source={createMachineKeepAliveSource(remote)} />)
    const box = await screen.findByRole('checkbox', { name: 'Keep SSH connections alive' })
    expect((box as HTMLInputElement).checked).toBe(false)
    fireEvent.click(box)
    await waitFor(() => expect(remote.update).toHaveBeenCalledWith('slop-machine', { keepConnectionsAlive: true }, 4))
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Keep SSH connections alive' }) as HTMLInputElement).checked).toBe(true))
  })

  it('explains when Machine is not enabled', async () => {
    const remote = { describe: vi.fn(async () => ({ namespaces: [] })), update: vi.fn() }
    render(<MachineKeepAlive source={createMachineKeepAliveSource(remote)} />)
    expect(await screen.findByText(/Machine is not enabled/)).toBeTruthy()
  })
})
