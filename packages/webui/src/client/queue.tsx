import type { Context } from '@deepseek-ai/cordis'
import type {} from './index.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SlopUiProvider } from '../context.tsx'
import '../style.css'
export const inject = ['slots', 'slopUi', 'uiWorkspace']
import { QueueSettings } from '../QueueSettings.tsx'
import { QueueFallbackModel } from '../QueueFallbackModel.tsx'
import { JobsIcon, JobsPage } from '../JobsPage.tsx'
import { createQueueFallbackSource, type LlmRemote } from './queue-fallback-source.ts'
import { registerQueueStatus } from '../chat-status-registration.tsx'
/** Main-panel key shared by the Jobs page and its sidebar row. */
export const JOBS_PANEL_ID = 'dsh-slop-jobs'
export function apply(ctx: Context): void {
  const { client, store } = ctx.slopUi
  registerQueueStatus(ctx, client, store)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: JOBS_PANEL_ID }, () =>
    <SlopUiProvider client={client} store={store}><JobsPage openChat={sessionId => { ctx.uiWorkspace.openSession(sessionId as Parameters<typeof ctx.uiWorkspace.openSession>[0]) }} /></SlopUiProvider>))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: JOBS_PANEL_ID, order: 20, label: 'Jobs' }, JobsIcon))
  // Provider suggestions are optional; a profile without the LLM Remote keeps free text entry.
  const fallbackSource = createQueueFallbackSource(ctx.slopUi.settings, () => ctx.get('remote.llm') as LlmRemote | undefined)
  ctx.effect(() => ctx.slopUi.settingsTabs.register({ id: 'queue', order: 40, label: 'Queue', render: () => <SlopUiProvider client={client} store={store}><QueueSettings compact /><QueueFallbackModel source={fallbackSource} /></SlopUiProvider> }), 'slopUi.settingsTabs.queue')
}
