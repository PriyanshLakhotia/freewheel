import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { RpcClient } from '../server/rpc.js';

test('Codex JSON-RPC pairs concurrent responses, emits notifications and handles disconnects', async () => {
  const rpc = new RpcClient(process.execPath, [resolve('tests/fixtures/rpc-server.mjs')]);
  try {
    await Promise.all([rpc.start(), rpc.start()]);
    const results = await Promise.all([
      rpc.request('echo', { id: 1 }),
      rpc.request('echo', { id: 2 }),
    ]);
    assert.deepEqual(results, [{ id: 1 }, { id: 2 }]);
    await assert.rejects(rpc.request('fail'), /Expected failure/);
    const event = new Promise<any>((resolve) => rpc.once('message', resolve));
    await rpc.request('event');
    assert.equal((await event).params.value, 42);
    await assert.rejects(rpc.request('die'), /disconnected/);
    await rpc.start();
    assert.deepEqual(await rpc.request('echo', { reconnected: true }), { reconnected: true });
  } finally {
    rpc.close();
  }
});
