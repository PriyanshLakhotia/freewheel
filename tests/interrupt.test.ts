import test from 'node:test';
import assert from 'node:assert/strict';
import { interruptionPhrase, availableInterruptionPhrase } from '../shared/speech.js';
import { agentEnvironment } from '../server/agent-env.js';
import { Speaker } from '../src/voice/speaker.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

test('playback controls are exact, reject quoted output, and never interpret task or approval text', () => {
  assert.equal(interruptionPhrase('Pause audio!', 'All tests passed.'), 'pause audio');
  assert.equal(interruptionPhrase('[unk] stop speaking', 'All tests passed.'), 'stop speaking');
  for (const text of [
    'stop',
    'stop working',
    'hey codex send it',
    'approve three',
    'pause [unk] audio',
    'do not pause audio',
  ])
    assert.equal(interruptionPhrase(text, 'All tests passed.'), undefined);
  assert.equal(interruptionPhrase('pause audio', 'The command is pause audio.'), undefined);
  assert.equal(availableInterruptionPhrase('The command is pause audio.'), 'stop speaking');
  assert.equal(availableInterruptionPhrase('Say pause audio or stop speaking.'), undefined);
});

test('both coding agents receive an environment without OpenAI audio keys or API overrides', () => {
  const source = {
    PATH: '/bin',
    AMP_API_KEY: 'amp-fixture',
    OPENAI_API_KEY: 'audio-fixture',
    OPENAI_BASE_URL: 'https://example.invalid',
    CODEX_API_KEY: 'codex-fixture',
    AZURE_OPENAI_API_KEY: 'azure-fixture',
  };
  assert.deepEqual(agentEnvironment(source), { PATH: '/bin', AMP_API_KEY: 'amp-fixture' });
  assert.equal(source.OPENAI_API_KEY, 'audio-fixture');
});

test('stopping pending cloud speech aborts the request without starting fallback playback', async (t) => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { speechSynthesis: { cancel() {} } },
  });
  let aborted = false;
  let fallbacks = 0;
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    assert.equal(url, '/api/audio/speech');
    return new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Stopped', 'AbortError'));
      });
    });
  });
  try {
    const speaker = new Speaker(
      () => ({ ...DEFAULT_SETTINGS, speech: 'openai' }),
      () => fallbacks++,
    );
    const speaking = speaker.say('This should never start playing.');
    speaker.stop();
    await speaking;
    assert.equal(aborted, true);
    assert.equal(fallbacks, 0);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
