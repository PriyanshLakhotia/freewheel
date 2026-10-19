import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcClient } from '../server/rpc.js';

const folder = await mkdtemp(join(tmpdir(), 'freewheel-test-'));
process.env.FREEWHEEL_DATA_DIR = folder;
const { Hub } = await import('../server/hub.js');
async function until(fn: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await delay(10);
  }
  throw new Error('Fixture did not reach expected state');
}
test('agent lifecycle: approval, stale reply, continuation, independent conversations and stop', async () => {
  const hub = new Hub(
    new RpcClient(process.execPath, [resolve('tests/fixtures/agent-server.mjs')]),
  );
  hub.state.connections.codex = { available: true, connected: true, detail: 'Fixture' };
  try {
    const task = await hub.dispatch('codex', 'default', 'await approval');
    await until(() => hub.state.approvals.length === 1);
    assert.equal(task.status, 'waiting');
    const approval = hub.state.approvals[0];
    assert.equal(approval.detail, 'npm test');
    assert.equal(approval.number, 1);
    const parallel = await hub.dispatch('codex', 'default', 'another task');
    assert.notEqual(parallel.externalId, task.externalId);
    await until(() => parallel.status === 'completed');
    assert.equal(task.status, 'waiting');
    await assert.rejects(
      hub.dispatch('codex', 'default', 'same conversation', task.id),
      /pending request/,
    );
    hub.answer(approval.id, 'accept');
    assert.throws(() => hub.answer(approval.id, 'accept'), /expired/);
    await until(() => task.status === 'completed');
    assert.equal(task.summary, 'Tests passed.');
    assert.equal(hub.state.approvals.length, 0);
    const continued = await hub.dispatch('codex', 'default', 'continue', task.id);
    assert.equal(continued.externalId, task.externalId);
    await until(() => continued.status === 'completed');
    const running = await hub.dispatch('codex', 'default', 'stay running');
    assert.equal(running.status, 'running');
    const steered = await hub.dispatch('codex', 'default', 'Also check types', running.id);
    assert.equal(steered.id, running.id);
    assert.match(steered.prompt, /Also check types/);
    await hub.stop(running.id);
    assert.equal(running.status, 'stopped');
    await assert.rejects(hub.stop(running.id), /no longer running/);
    hub.secrets.openai = 'sk-testsecretabcdefghijklmnopqrstuvwxyz';
    assert.equal(
      hub.clean('Key sk-testsecretabcdefghijklmnopqrstuvwxyz leaked'),
      'Key [redacted] leaked',
    );
  } finally {
    hub.close();
    await delay(50);
    await rm(folder, { recursive: true, force: true });
  }
});

test('Codex refuses API-key accounts before starting any coding thread', async () => {
  const hub = new Hub(
    new RpcClient(process.execPath, [resolve('tests/fixtures/agent-server.mjs'), '--api-key']),
  );
  hub.state.connections.codex = {
    available: true,
    connected: true,
    detail: 'Previously connected',
  };
  try {
    await assert.rejects(
      hub.dispatch('codex', 'default', 'Do some coding'),
      /API-key coding is disabled/,
    );
    assert.equal(hub.state.connections.codex.connected, false);
    assert.equal(hub.state.tasks.at(-1)?.externalId, undefined);
    assert.equal(hub.state.tasks.at(-1)?.status, 'error');
  } finally {
    hub.close();
    await delay(50);
    await rm(folder, { recursive: true, force: true });
  }
});

test('a Puck reply becomes one task and one spoken announcement', async (t) => {
  const hub = new Hub();
  hub.state.connections.amp = { available: true, connected: true, detail: 'Fixture' };
  hub.state.settings.ampMode = 'puck';
  const threadId = 'T-00000000-0000-0000-0000-000000000001';
  let sent = '';
  const announcements: string[] = [];
  hub.on('event', (event) => {
    if (event.type === 'announce') announcements.push(event.taskId);
  });
  t.mock.method(hub.puck, 'send', async (message: string) => {
    sent = message;
    return {
      conversationID: threadId,
      replyHandle: null,
      status: 'replied' as const,
      reply: 'Ready.',
    };
  });
  t.mock.method(hub.amp, 'readPuck', async () => ({
    id: threadId,
    agentMode: 'puck',
    messages: [
      { role: 'user', content: [{ type: 'text', text: sent }] },
      {
        role: 'assistant',
        messageId: 2,
        state: { type: 'complete', stopReason: 'end_turn' },
        content: [{ type: 'text', text: 'Ready.' }],
      },
    ],
  }));
  try {
    const count = hub.state.tasks.length;
    const task = await hub.dispatch('amp', 'default', 'Check the connection');
    await until(() => task.status === 'completed');
    assert.equal(task.output, 'Ready.');
    assert.equal(hub.state.tasks.length, count + 1);
    assert.deepEqual(announcements, [task.id]);
  } finally {
    hub.close();
    await delay(50);
    await rm(folder, { recursive: true, force: true });
  }
});
