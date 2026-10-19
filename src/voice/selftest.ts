import {
  detectWake,
  WAKE_GRAMMAR,
  INTERRUPT_GRAMMAR,
  interruptionPhrase,
} from '../../shared/speech';
import { loadOfflineModel } from './model';
export async function checkOfflineSpeech(): Promise<string> {
  const model = await loadOfflineModel();
  const context = new AudioContext({ sampleRate: 16000 });
  const results: string[] = [];
  try {
    const cases = [
      { name: 'codex', expected: 'codex', stop: false },
      { name: 'puck', expected: 'amp', stop: false },
      { name: 'ambient', expected: undefined, stop: false },
      { name: 'pause', expected: 'pause audio', stop: true },
      { name: 'stop', expected: 'stop speaking', stop: true },
      { name: 'reply', expected: undefined, stop: true },
    ];
    for (const sample of cases) {
      const response = await fetch(`/diagnostics/${sample.name}.wav`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const recognizer = new model.KaldiRecognizer(
        buffer.sampleRate,
        sample.stop ? INTERRUPT_GRAMMAR : WAKE_GRAMMAR,
      );
      const text = await new Promise<string>((resolve, reject) => {
        let transcript = '';
        const timer = setTimeout(() => reject(new Error('Offline speech check timed out.')), 20000);
        recognizer.on('result', (message) => {
          if (message.event === 'result') {
            transcript += ' ' + message.result.text;
            if (transcript.trim()) {
              clearTimeout(timer);
              resolve(transcript.trim());
            }
          }
        });
        recognizer.on('error', () => {
          clearTimeout(timer);
          reject(new Error('Offline speech check failed.'));
        });
        recognizer.acceptWaveform(buffer);
        recognizer.retrieveFinalResult();
      });
      recognizer.remove();
      const detected = sample.stop
        ? interruptionPhrase(text, 'The tests passed.')
        : detectWake(text.replace(/\[unk\]/g, '').trim())?.agent;
      const passed = detected === sample.expected;
      results.push(`${passed ? 'PASS' : 'FAIL'} · ${sample.name}: “${text}”`);
    }
    return results.join('\n');
  } finally {
    model.terminate();
    await context.close();
  }
}
