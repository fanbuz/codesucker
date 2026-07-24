import { parentPort } from 'node:worker_threads';
import {
  annotate, cleanFile, readSourceAsync, scanFileCandidate,
} from '@codesucker/core';
import type {
  PipelineWorkerRequest, PipelineWorkerResult, PreviewResult, WorkerEnvelope, WorkerReply,
} from './protocol.ts';

if (!parentPort) throw new Error('pipeline worker missing parentPort');

async function execute(payload: PipelineWorkerRequest): Promise<PipelineWorkerResult> {
  if (payload.type === 'scan') return scanFileCandidate(payload.candidate);

  const { text, encoding } = await readSourceAsync(payload.entry.path);
  const entry = { ...payload.entry, encoding };
  if (payload.type === 'clean') return cleanFile(entry, text, payload.clean);

  const annotated = annotate(text, entry.ext, payload.clean).slice(0, 14);
  const preview: PreviewResult = {
    file: entry.name,
    before: annotated.map((line, index) => ({
      n: index + 1,
      text: line.text,
      kind: line.kind,
      masked: line.masked,
    })),
    after: annotated.flatMap((line) => line.out.map((value) => ({ text: value, masked: line.masked }))).slice(0, 10),
    removedComments: annotated.filter((line) => line.kind === 'comment').length,
    removedBlanks: annotated.filter((line) => line.kind === 'blank' && line.out.length === 0).length,
    masked: annotated.filter((line) => line.masked).length,
  };
  return preview;
}

parentPort.on('message', async ({ id, payload }: WorkerEnvelope<PipelineWorkerRequest>) => {
  const reply: WorkerReply<PipelineWorkerResult> = { id };
  try {
    reply.result = await execute(payload);
  } catch (error) {
    reply.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }
  parentPort!.postMessage(reply);
});
