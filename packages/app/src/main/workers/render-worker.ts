import { parentPort } from 'node:worker_threads';
import { renderDocx } from '@codesucker/core';
import type { RenderWorkerRequest, WorkerEnvelope, WorkerReply } from './protocol.ts';

if (!parentPort) throw new Error('render worker missing parentPort');

parentPort.on('message', async ({ id, payload }: WorkerEnvelope<RenderWorkerRequest>) => {
  const reply: WorkerReply<string> = { id };
  try {
    reply.result = await renderDocx(payload.pages, payload.options);
  } catch (error) {
    reply.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }
  parentPort!.postMessage(reply);
});
