import { LOCAL_OWNER_PRINCIPAL_ID } from '@dsh-slop/core'
import type { SshBroker } from './native-ssh-broker.ts'

/** Well inside the 12-hour app-managed idle horizon, and cheap: one `true` per live master. */
export const SSH_KEEPALIVE_INTERVAL_MS = 30 * 60_000

/**
 * Renew masters that are already authenticated by running `true` through each,
 * which resets OpenSSH's ControlPersist idle timer and the native idle reaper.
 * A master that is gone is left gone: this never starts authentication, so a
 * 2FA Machine still needs the user after a network drop or Host restart.
 */
export async function renewReadyConnections(broker: Pick<SshBroker, 'readyMachineIds' | 'reconcileStatus' | 'connect' | 'run' | 'release'>, signal?: AbortSignal): Promise<void> {
  for (const machineId of broker.readyMachineIds()) {
    if (signal?.aborted === true) return
    try {
      if ((await broker.reconcileStatus(machineId, signal)).state !== 'ready') continue
      const lease = await broker.connect(machineId, LOCAL_OWNER_PRINCIPAL_ID)
      try { await broker.run(lease.id, ['true'], undefined, 30_000, 1024, signal) } finally { await broker.release(lease.id, LOCAL_OWNER_PRINCIPAL_ID) }
    } catch {
      // The next real use reports the connection state.
    }
  }
}
