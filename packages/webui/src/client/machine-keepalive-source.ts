import type { MachineKeepAliveSource, MachineKeepAliveView } from '../MachineKeepAlive.tsx'
import { describeNamespace, isRecord, updateNamespace, type NamespaceView, type SettingsRemote } from './settings-remote.ts'

/** Profile entry id of the Machine component, which owns connection renewal. */
export const MACHINE_SETTINGS_NAMESPACE = 'slop-machine'

function viewOf(namespace: NamespaceView | undefined, writable: boolean): MachineKeepAliveView {
  if (namespace === undefined || !isRecord(namespace.value) || typeof namespace.revision !== 'number') {
    throw new Error('Machine is not enabled, so its connection settings are unavailable.')
  }
  return { enabled: namespace.value.keepConnectionsAlive === true, revision: namespace.revision, writable }
}

export function createMachineKeepAliveSource(remote: SettingsRemote): MachineKeepAliveSource {
  return {
    async load() {
      const { namespace, writable } = await describeNamespace(remote, MACHINE_SETTINGS_NAMESPACE)
      return viewOf(namespace, writable)
    },
    async save(enabled, expectedRevision) {
      return viewOf(await updateNamespace(remote, MACHINE_SETTINGS_NAMESPACE, { keepConnectionsAlive: enabled }, expectedRevision), true)
    },
  }
}
