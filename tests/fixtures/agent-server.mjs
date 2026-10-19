import { createInterface } from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let thread = 0;
let turn = 0;
let waiting;
const paths = new Map();
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: {} });
  else if (m.method === 'thread/start') {
    const id = 'thread-' + ++thread;
    paths.set(id, m.params.cwd);
    send({ id: m.id, result: { thread: { id } } });
  } else if (m.method === 'thread/read')
    send({
      id: m.id,
      result: {
        thread: {
          id: m.params.threadId,
          cwd: paths.get(m.params.threadId),
          status: { type: 'idle' },
        },
      },
    });
  else if (m.method === 'thread/resume')
    send({ id: m.id, result: { thread: { id: m.params.threadId } } });
  else if (m.method === 'turn/start') {
    const turnId = 'turn-' + ++turn;
    const threadId = m.params.threadId;
    send({ id: m.id, result: { turn: { id: turnId } } });
    if (m.params.input[0].text.includes('await approval')) {
      waiting = { threadId, turnId };
      send({
        id: 999,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId,
          turnId,
          itemId: 'cmd',
          command: 'npm test',
          reason: 'Run the project tests',
        },
      });
    } else if (m.params.input[0].text.includes('stay running')) {
    } else {
      send({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: {
            type: 'agentMessage',
            id: 'message',
            text: 'The fixture completed successfully.',
          },
        },
      });
      send({
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      });
    }
  } else if (m.method === 'turn/interrupt') {
    send({ id: m.id, result: {} });
    send({
      method: 'turn/completed',
      params: { threadId: m.params.threadId, turn: { id: m.params.turnId, status: 'interrupted' } },
    });
  } else if (m.id === 999 && waiting) {
    const { threadId, turnId } = waiting;
    waiting = null;
    send({ method: 'serverRequest/resolved', params: { threadId, requestId: 999 } });
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: {
          type: 'agentMessage',
          id: 'result',
          text: m.result.decision === 'accept' ? 'Tests passed.' : 'Command declined.',
        },
      },
    });
    send({
      method: 'turn/completed',
      params: { threadId, turn: { id: turnId, status: 'completed' } },
    });
  }
});
