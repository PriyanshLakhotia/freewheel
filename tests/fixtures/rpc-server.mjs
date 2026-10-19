import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fake' } });
  else if (m.method === 'echo') send({ id: m.id, result: m.params });
  else if (m.method === 'fail')
    send({ id: m.id, error: { code: -1, message: 'Expected failure' } });
  else if (m.method === 'die') process.exit(0);
  else if (m.method === 'event') {
    send({ method: 'test/notification', params: { value: 42 } });
    send({ id: m.id, result: { ok: true } });
  }
});
