import { parentPort, threadId } from 'node:worker_threads';

parentPort.on('message', ({ id, payload }) => {
  if (payload.action === 'crash') process.exit(23);
  const send = () => parentPort.postMessage({ id, result: { value: payload.value, threadId } });
  if (payload.delayMs) setTimeout(send, payload.delayMs);
  else send();
});
