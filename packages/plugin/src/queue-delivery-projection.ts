import type { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from './queue-runtime.ts'
import { z } from 'zod'

const referenceSchema = z.object({ id: z.string(), dispatchId: z.string().optional() }).strict()
const stateSchema = z.object({
  'next-turn': z.array(referenceSchema),
  'next-step': z.array(referenceSchema),
  messageIds: z.record(z.string(), z.string()),
  receipts: z.record(z.string(), z.enum(['enqueued', 'claimed', 'consumed', 'discarded'])),
}).strict()
/** Host-only unit state; no client view, so it stays out of `SessionProjectionMap`. */
export type DeliveryProjection = z.output<typeof stateSchema>
function dispatchOf(message: Message): string | undefined {
  return message.source.kind === 'dsh-slop-queue' ? message.source.dispatchId : undefined
}

/** Native events own consumption and cancellation. This fold adds only Queue's receipt index. */
export const queueDeliveryProjection: ProjectionDefinition<'slopQueueDelivery', DeliveryProjection> = {
  key: 'slopQueueDelivery', stateVersion: 2, stateSchema,
  init: () => ({ 'next-turn': [], 'next-step': [], receipts: {}, messageIds: {} }),
  apply(state, event) {
    if (event.type === 'user/message') {
      const id = dispatchOf(event.data)
      return id === undefined ? state : { ...state, receipts: { ...state.receipts, [id]: 'consumed' } }
    }
    if (event.type !== 'agent/inbox/spliced') return state
    const splice = event.data
    const list = [...state[splice.target]]
    const inserted = splice.inserted.map(message => {
      const dispatchId = dispatchOf(message)
      return { id: message.id, ...(dispatchId === undefined ? {} : { dispatchId }) }
    })
    const removed = list.splice(splice.start, splice.removedCount ?? 0, ...inserted)
    const receipts = { ...state.receipts }
    const messageIds = { ...state.messageIds }
    for (const ref of removed) if (ref.dispatchId !== undefined && receipts[ref.dispatchId] !== 'consumed') receipts[ref.dispatchId] = splice.outcome === 'canceled' ? 'discarded' : 'claimed'
    for (const ref of inserted) if (ref.dispatchId !== undefined) { receipts[ref.dispatchId] = 'enqueued'; messageIds[ref.dispatchId] = ref.id }
    return { ...state, [splice.target]: list, receipts, messageIds }
  },
}
/** Registration is asynchronous; the caller reads receipts through the returned handle. */
export async function registerQueueDeliveryProjection(ctx: Context): Promise<ProjectionHandle<DeliveryProjection>> {
  return ctx.sessionProjections.register(queueDeliveryProjection)
}
