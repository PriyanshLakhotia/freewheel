import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../src/voice/controller.js';
import { Recognition } from '../src/voice/recognition.js';
import { Speaker } from '../src/voice/speaker.js';
import { DEFAULT_SETTINGS, type State } from '../shared/types.js';

test('voice dispatch requires a wake phrase and confirmation; generic yes never grants permissions', async (t) => {
  const calls: { url: string; body: any }[] = [];
  const spoken: string[] = [];
  t.mock.method(Recognition.prototype, 'start', async () => {});
  t.mock.method(Recognition.prototype, 'stop', () => {});
  t.mock.method(Recognition.prototype, 'suppress', () => {});
  t.mock.method(Speaker.prototype, 'say', async (text: string) => {
    spoken.push(text);
  });
  t.mock.method(Speaker.prototype, 'stop', () => {});
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    return new Response(JSON.stringify({ id: 'new-task' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const state: State = {
    projects: [{ id: 'p', name: 'My app', path: '/tmp/project' }],
    tasks: [],
    approvals: [
      {
        id: 'approval',
        number: 3,
        taskId: 't',
        agent: 'codex',
        kind: 'command',
        title: 'Run tests',
        detail: 'npm test',
        createdAt: Date.now(),
      },
    ],
    settings: { ...DEFAULT_SETTINGS },
    connections: {
      amp: { available: true, connected: true, detail: '' },
      codex: { available: true, connected: true, detail: '' },
    },
    credentials: { amp: false, openai: false },
    awake: false,
    platform: 'darwin',
    modelReady: false,
    audioSpend: 0,
  };
  const controller = new VoiceController({
    state: () => state,
    project: () => 'p',
    selected: () => undefined,
    select: () => {},
    view: () => {},
    notice: () => {},
  });
  try {
    await controller.start();
    await controller.hear('Fix the tests');
    assert.equal(calls.length, 0);
    await controller.hear('Hey Codex, fix the tests');
    assert.equal(calls.length, 0);
    assert(spoken.at(-1)?.includes('Say send it'));
    await controller.hear('yes');
    assert.equal(calls.length, 0);
    await controller.hear('send it');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.agent, 'codex');
    assert.equal(calls[0].body.prompt, 'fix the tests');
    await controller.hear('Hey Puck, approve three');
    assert.equal(calls.length, 1);
    await controller.hear('Hey Codex, approve three');
    assert.equal(calls.at(-1)?.url, '/api/approvals/approval');
    assert.equal(calls.at(-1)?.body.decision, 'accept');
    controller.end();
    await controller.hear('Hey Codex, send it');
    assert.equal(calls.length, 2);
    assert.equal(controller.view.active, false);

    state.settings.followUpSeconds = 0;
    await controller.start();
    await controller.hear('Hey Puck');
    await controller.hear('Investigate the slow build');
    assert(
      spoken.at(-1)?.includes('Say send it'),
      'an explicit wake must allow dictation with automatic follow-ups disabled',
    );
    assert.equal(calls.length, 2);
    await controller.hear('cancel');

    let finishSpeech!: () => void;
    t.mock.method(
      Speaker.prototype,
      'say',
      () =>
        new Promise<void>((resolve) => {
          finishSpeech = resolve;
        }),
    );
    const delayed = controller.say('An update is being read.', 'codex');
    assert.equal(controller.view.phase, 'speaking');
    controller.hush();
    finishSpeech();
    await delayed;
    assert.equal(
      controller.view.phase,
      'listening',
      'old playback must not reopen the listening window after it is stopped',
    );
    assert.equal(controller.view.agent, undefined);
  } finally {
    controller.end();
  }
});

test('OpenAI mode transcribes commands and confirmations, ignores browser command text, and holds updates during dictation', async (t) => {
  const spoken: string[] = [];
  const sent: any[] = [];
  let captures = 0;
  let transcriptions = 0;
  let releaseCapture!: () => void;
  const captureGate = new Promise<void>((resolve) => {
    releaseCapture = resolve;
  });
  t.mock.method(Recognition.prototype, 'start', async function (this: Recognition) {
    this.stream = {} as MediaStream;
    this.context = {} as AudioContext;
  });
  t.mock.method(Recognition.prototype, 'stop', () => {});
  t.mock.method(Recognition.prototype, 'suppress', () => {});
  t.mock.method(Speaker.prototype, 'say', async (text: string) => {
    spoken.push(text);
  });
  t.mock.method(Speaker.prototype, 'stop', () => {});
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    if (String(url).startsWith('/api/audio/transcribe')) {
      transcriptions++;
      assert(options.body instanceof Blob);
      return Response.json({
        text: transcriptions === 1 ? 'Investigate the slow build' : 'send it',
      });
    }
    sent.push(JSON.parse(options.body));
    return Response.json({ id: 'new-task' });
  });
  const state = {
    projects: [{ id: 'p', name: 'Project', path: '/tmp/p' }],
    tasks: [],
    approvals: [],
    settings: { ...DEFAULT_SETTINGS, transcription: 'openai' },
    modelReady: true,
  } as unknown as State;
  const selected: string[] = [];
  const controller = new VoiceController({
    state: () => state,
    project: () => 'p',
    selected: () => undefined,
    select: (_agent, id) => {
      if (id) selected.push(id);
    },
    view: () => {},
    notice: () => {},
    capture: async () => {
      captures++;
      if (captures === 1) await captureGate;
      return captures <= 2
        ? { blob: new Blob(['fixture'], { type: 'audio/webm' }), seconds: 2 }
        : undefined;
    },
  });
  t.mock.method(controller as any, 'earcon', () => {});
  try {
    await controller.start();
    const listening = controller.hear('Hey Puck, browser text must never be sent');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(controller.view.phase, 'recording');
    controller.announce('Earlier work finished.', 'codex', false, 'earlier-task');
    assert(!spoken.includes('Earlier work finished.'));
    releaseCapture();
    await listening;
    assert.equal(transcriptions, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].prompt, 'Investigate the slow build');
    assert.equal(sent[0].agent, 'amp');
    assert(spoken.includes('Earlier work finished.'));
    assert.equal(
      selected.at(-1),
      'earlier-task',
      'spoken updates select their own conversation for follow-ups',
    );
  } finally {
    controller.end();
  }
});
