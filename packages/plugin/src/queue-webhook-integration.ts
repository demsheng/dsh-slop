import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { queueTargetSchema } from '@dsh-slop/queue'
import { z } from 'zod'
import { admitLocalRequest, HttpAdmissionError, readJsonBody, writeJson } from './admission.ts'
import { queueJsonOutput, queueTargetValueSchema } from './queue-tool-schema.ts'
import { queueSessionTargetForAgent } from './queue-runtime.ts'
import type { QueueWebhook } from './queue-webhook.ts'

export const QUEUE_WEBHOOK_SETTINGS_PATH = '/dsh-slop/queue-webhook'

export async function serveQueueWebhookSettings(req: IncomingMessage,res: ServerResponse,nonce: string,webhook: Pick<QueueWebhook,'update'|'testPublic'|'view'>,trustedHosts: readonly string[]): Promise<void> {
  try {
    admitLocalRequest(req,nonce,true,trustedHosts)
    if (req.method === 'PUT') await webhook.update(await readJsonBody(req,'PUT'))
    else if (req.method === 'POST') {
      z.object({ action: z.literal('test') }).strict().parse(await readJsonBody(req,'POST'))
      await webhook.testPublic()
    } else if (req.method !== 'GET') throw new HttpAdmissionError(405,'GET, PUT or POST required')
    writeJson(res,200,webhook.view())
  } catch (error) {
    writeJson(res,error instanceof HttpAdmissionError ? error.status : 400,{ error: error instanceof HttpAdmissionError ? error.message : error instanceof z.ZodError ? 'Invalid webhook configuration or request.' : error instanceof Error ? error.message : 'Webhook settings request failed.' })
  }
}

/** Both the optional tool and its guidance appear/disappear when configuration changes. */
export function registerQueueWebhookIntegration(ctx: Context,webhook: QueueWebhook): () => void {
  let disposeTool: (() => void) | undefined
  let disposePrompt: (() => void) | undefined
  const refresh = () => {
    disposeTool?.(); disposePrompt?.(); disposeTool = undefined; disposePrompt = undefined
    if (!webhook.view().enabled) return
    disposePrompt = ctx.systemPrompt.section({ name: 'slop:queue-webhook', order: 520,
      text: 'Queue callbacks are optional observation for suitable new work, except on Machines disabled in Queue settings. Load queue-tracking and read its callbacks reference before using slop_queue_prepare. Polling remains the default: never change an existing wrapper, dispatcher, working directory, log paths, traps or exit status to add callbacks. Do not obtain or expose Cloudflare credentials.' })
    disposeTool = ctx.tools.register(defineTool({
      name: 'slop_queue_prepare',
      description: 'Allocate one optional callback helper per intended execution of a Bash script already being created or edited. Reuse the returned helper for that execution. Keep existing wrappers unchanged and use polling when callbacks would change the workflow. Does not submit work or create a Queue task. After submission use queueItemId as slop_queue_track.id.',
      parameters: {
        target: { ...queueTargetValueSchema, required: true },
        observerKind: { type: 'string', enum: ['slurm','pbs','process'], required: true },
      },
      output: queueJsonOutput({ type: 'object', properties: {
        queueItemId: { type: 'string', required: true }, script: { type: 'string', required: true }, instructions: { type: 'string', required: true },
      }, additionalProperties: false }),
      async execute(args,execution) {
        if (execution.agent === undefined) throw new Error('Callbacks require an owning Chat')
        const input = z.object({ target: queueTargetSchema, observerKind: z.enum(['slurm','pbs','process']) }).strict().parse(args)
        return webhook.prepare(input.target,queueSessionTargetForAgent(execution.agent),input.observerKind)
      },
    }))
  }
  refresh()
  const off = webhook.onChange(refresh)
  return () => { off(); disposeTool?.(); disposePrompt?.() }
}
