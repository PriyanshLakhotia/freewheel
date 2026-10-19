import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioService } from '../server/audio.js';
import { Hub } from '../server/hub.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

test('cloud audio requires credentials, reserves budget before a request, and uses fixed API hosts', async (t) => {
  // Use only the interface AudioService consumes; no agent process or store is started.
  const port = {
    secrets: {} as { openai?: string },
    state: { settings: { ...DEFAULT_SETTINGS, audioBudget: 0.0002 }, audioSpend: 0 },
    changed: () => {},
  };
  const audio = new AudioService(port as Hub);
  let requested = 0;
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    requested++;
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(JSON.parse(options.body).model, 'tts-1');
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });
  await assert.rejects(audio.speech('Hello'), /API key/);
  assert.equal(requested, 0);
  port.secrets.openai = 'test-only';
  await assert.rejects(
    audio.speech('An overly long reply that exceeds the tiny fixture budget.'),
    /budget reached/,
  );
  assert.equal(requested, 0);
  assert.deepEqual(await audio.speech('Hello'), Buffer.from([1, 2, 3]));
  assert.equal(requested, 1);
  assert(port.state.audioSpend > 0);
});
