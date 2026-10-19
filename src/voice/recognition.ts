import type { Model, KaldiRecognizer } from 'vosk-browser';
import { loadOfflineModel } from './model';
import {
  WAKE_GRAMMAR,
  INTERRUPT_GRAMMAR,
  detectWake,
  interruptionPhrase,
} from '../../shared/speech';
export interface RecognitionCallbacks {
  final: (text: string) => void;
  partial: (text: string) => void;
  error: (message: string) => void;
  level: (value: number) => void;
  interrupt: () => void;
  warning: (message: string) => void;
}
export class Recognition {
  stream?: MediaStream;
  context?: AudioContext;
  private browser: any;
  private model?: Model;
  private recognizer?: KaldiRecognizer;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private frame = 0;
  private active = false;
  private suppressed = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private commandMode = false;
  private playback?: string;
  private generation = 0;
  get canInterrupt() {
    return !!this.model;
  }
  constructor(
    private callbacks: RecognitionCallbacks,
    private loadModel = loadOfflineModel,
  ) {}
  static browserSupported() {
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }
  async start(engine: 'browser' | 'offline', localInterruptions = false) {
    const generation = ++this.generation;
    this.active = true;
    this.suppressed = false;
    this.failures = 0;
    this.commandMode = false;
    this.playback = undefined;
    try {
      if (engine === 'browser' && !Recognition.browserSupported()) {
        throw new Error(
          'Use Chrome for browser speech, or choose offline recognition in Connections.',
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      if (!this.active || generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (this.active) {
          this.callbacks.error(
            'Microphone disconnected. Reconnect your earphones and start again.',
          );
          this.stop();
        }
      });
      const context = (this.context = new AudioContext());
      await context.resume();
      if (!this.active || generation !== this.generation) {
        if (context.state !== 'closed') await context.close();
        return;
      }
      this.source = this.context.createMediaStreamSource(this.stream);
      const meter = this.context.createAnalyser();
      meter.fftSize = 256;
      this.source.connect(meter);
      const values = new Float32Array(meter.fftSize);
      const tick = () => {
        if (!this.active) return;
        meter.getFloatTimeDomainData(values);
        this.callbacks.level(
          Math.min(1, Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length) * 5),
        );
        this.frame = requestAnimationFrame(tick);
      };
      tick();
      if (engine === 'offline' || localInterruptions) {
        try {
          await this.local(engine === 'offline', generation);
        } catch (error) {
          if (generation !== this.generation) return;
          if (engine === 'offline') throw error;
          this.callbacks.warning(
            'Local stop detection could not load. The Stop speaking button is still available.',
          );
        }
      }
      if (!this.active || generation !== this.generation) return;
      if (engine === 'browser') this.webSpeech();
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }
  private offlineCommands = false;
  private async local(offlineCommands: boolean, generation: number) {
    const model = await this.loadModel();
    if (!this.active || generation !== this.generation) {
      model.terminate();
      return;
    }
    this.model = model;
    this.offlineCommands = offlineCommands;
    this.makeRecognizer();
    this.processor = this.context!.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (this.active && (!this.suppressed || this.playback !== undefined))
        this.recognizer?.acceptWaveform(event.inputBuffer);
    };
    this.source!.connect(this.processor);
    this.processor.connect(this.context!.destination);
  }
  private makeRecognizer() {
    if (!this.model || !this.context || !this.active) return;
    const playback = this.playback;
    const interruptOnly = playback !== undefined;
    if (!interruptOnly && (this.suppressed || !this.offlineCommands)) return;
    const commandMode = this.commandMode;
    let interrupted = false;
    const recognizer = (this.recognizer = new this.model.KaldiRecognizer(
      this.context.sampleRate,
      interruptOnly ? INTERRUPT_GRAMMAR : commandMode ? undefined : WAKE_GRAMMAR,
    ));
    const tryInterrupt = (text: string) => {
      if (!interrupted && interruptionPhrase(text, playback || '')) {
        interrupted = true;
        this.callbacks.interrupt();
      }
    };
    recognizer.on('result', (message) => {
      if (
        this.recognizer === recognizer &&
        message.event === 'result' &&
        this.active &&
        message.result.text
      ) {
        if (interruptOnly) {
          tryInterrupt(message.result.text);
          return;
        }
        if (this.suppressed) return;
        if (commandMode) this.callbacks.final(message.result.text);
        else {
          const wake = detectWake(message.result.text.replace(/\[unk\]/g, '').trim());
          if (wake) this.callbacks.final(wake.agent === 'amp' ? 'hey puck' : 'hey codex');
        }
      }
    });
    recognizer.on('partialresult', (message) => {
      if (this.recognizer === recognizer && message.event === 'partialresult' && this.active) {
        if (interruptOnly) tryInterrupt(message.result.partial);
        else if (!this.suppressed) this.callbacks.partial(message.result.partial);
      }
    });
    recognizer.on('error', () => {
      if (this.recognizer === recognizer)
        this.callbacks.error('Local recognition stopped. Start listening again.');
    });
  }
  setCommandMode(enabled: boolean) {
    if (enabled === this.commandMode) return;
    this.commandMode = enabled;
    this.recognizer?.remove();
    this.recognizer = undefined;
    if (this.model && !this.suppressed) this.makeRecognizer();
  }
  listenForInterruptions(text?: string) {
    this.playback = text;
    this.recognizer?.remove();
    this.recognizer = undefined;
    this.makeRecognizer();
  }
  private webSpeech() {
    const Constructor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Constructor)
      throw new Error(
        'This browser does not support live speech. Use Chrome, or install offline recognition in Connections.',
      );
    const browser = (this.browser = new Constructor());
    this.browser.continuous = true;
    this.browser.interimResults = true;
    this.browser.lang = 'en-US';
    this.browser.onresult = (event: any) => {
      if (this.browser !== browser) return;
      this.failures = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (this.suppressed || !this.active) return;
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) this.callbacks.final(text);
        else this.callbacks.partial(text);
      }
    };
    this.browser.onerror = (event: any) => {
      if (this.browser !== browser) return;
      if (
        !this.active ||
        this.suppressed ||
        event.error === 'aborted' ||
        event.error === 'no-speech'
      )
        return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        this.callbacks.error(
          'Microphone access is unavailable. Allow microphone access for Freewheel in your browser and macOS settings.',
        );
        this.stop();
      } else if (++this.failures >= 3) {
        this.callbacks.error(
          'Browser speech could not reconnect. Check your connection, or use offline recognition.',
        );
        this.stop();
      }
    };
    this.browser.onend = () => {
      if (this.browser === browser) this.scheduleRestart();
    };
    this.browser.start();
  }
  private scheduleRestart() {
    clearTimeout(this.restartTimer);
    if (!this.active || this.suppressed || !this.browser) return;
    this.restartTimer = setTimeout(
      () => {
        if (this.active && !this.suppressed)
          try {
            this.browser.start();
          } catch {
            this.scheduleRestart();
          }
      },
      this.failures ? Math.min(4000, 500 * 2 ** this.failures) : 200,
    );
  }
  suppress(value: boolean) {
    this.suppressed = value;
    if (value) {
      this.playback = undefined;
      clearTimeout(this.restartTimer);
      this.browser?.abort();
      // Discard buffered speech before output, so it cannot be replayed as a new command.
      this.recognizer?.remove();
      this.recognizer = undefined;
    } else {
      if (this.model && !this.recognizer) this.makeRecognizer();
      this.scheduleRestart();
    }
  }
  stop() {
    this.generation++;
    this.active = false;
    this.playback = undefined;
    clearTimeout(this.restartTimer);
    cancelAnimationFrame(this.frame);
    this.browser?.abort();
    this.browser = undefined;
    this.recognizer?.remove();
    this.recognizer = undefined;
    this.model?.terminate();
    this.model = undefined;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    void this.context?.close();
    this.context = undefined;
  }
}
