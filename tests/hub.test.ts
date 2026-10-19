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
test('agent lifecycle: approval, stale reply, continuation, concurrent turn rejection and stop', async () => {
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
    await assert.rejects(hub.dispatch('codex', 'default', 'another task'), /already working/);
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
