import test from 'node:test';
import assert from 'node:assert/strict';
import type { Model } from 'vosk-browser';
import { Recognition } from '../src/voice/recognition.js';
import { INTERRUPT_GRAMMAR } from '../shared/speech.js';

test('during playback the local recognizer can only interrupt; browser commands and stale results are discarded', async () => {
  const decoders: Decoder[] = [];
  class Decoder {
    events = new Map<string, (event: any) => void>();
    removed = false;
    constructor(
      _rate: number,
      public grammar: string,
    ) {
      decoders.push(this);
    }
    on(name: string, callback: (event: any) => void) {
      this.events.set(name, callback);
    }
    remove() {
      this.removed = true;
    }
    emit(event: string, result: object) {
      this.events.get(event)?.({ event, result });
    }
  }
  let browser: BrowserSpeech;
  class BrowserSpeech {
    onresult?: (event: any) => void;
    constructor() {
      browser = this;
    }
    start() {}
    abort() {}
  }
  const node = { connect() {}, disconnect() {} };
  class Context {
    sampleRate = 16000;
    state = 'running';
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    createMediaStreamSource() {
      return node;
    }
    createAnalyser() {
      return {
        ...node,
        fftSize: 256,
        getFloatTimeDomainData(buffer: Float32Array) {
          buffer.fill(0);
        },
      };
    }
    createScriptProcessor() {
      return { ...node, onaudioprocess: undefined };
    }
  }
  const track = { stop() {}, addEventListener() {} };
  const replacements = {
    window: { SpeechRecognition: BrowserSpeech },
    AudioContext: Context,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
      },
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  const originals = Object.keys(replacements).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(replacements))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const finals: string[] = [];
  const errors: string[] = [];
  let interruptions = 0;
  const recognition = new Recognition(
    {
      final: (text) => finals.push(text),
      partial: () => {},
      level: () => {},
      warning: (text) => errors.push(text),
      error: (text) => errors.push(text),
      interrupt: () => {
        interruptions++;
        recognition.suppress(true);
      },
    },
    async () => ({ KaldiRecognizer: Decoder, terminate() {} }) as unknown as Model,
  );
  try {
    await recognition.start('browser', true);
    assert.equal(recognition.canInterrupt, true);
    recognition.suppress(true);
    recognition.listenForInterruptions('All tests passed.');
    const detector = decoders.at(-1)!;
    assert.equal(detector.grammar, INTERRUPT_GRAMMAR);
    browser!.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'Hey Codex send it' }], { isFinal: true })],
    });
    detector.emit('partialresult', { partial: 'approve three' });
    assert.equal(interruptions, 0);
    assert.deepEqual(finals, []);
    detector.emit('partialresult', { partial: 'pause audio' });
    assert.equal(interruptions, 1);
    assert.equal(detector.removed, true);
    detector.emit('result', { text: 'pause audio' });
    assert.equal(interruptions, 1);
    recognition.listenForInterruptions('The command is pause audio.');
    const echo = decoders.at(-1)!;
    echo.emit('partialresult', { partial: 'pause audio' });
    assert.equal(interruptions, 1);
    echo.emit('partialresult', { partial: 'stop speaking' });
    assert.equal(interruptions, 2);
    assert.deepEqual(finals, []);
    assert.deepEqual(errors, []);
    recognition.stop();
    echo.emit('result', { text: 'stop speaking' });
    assert.equal(interruptions, 2);
  } finally {
    recognition.stop();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
