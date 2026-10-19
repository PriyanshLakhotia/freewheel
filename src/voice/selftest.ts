import { detectWake, WAKE_GRAMMAR } from '../../shared/speech';
import { loadOfflineModel } from './model';
export async function checkOfflineSpeech(): Promise<string> {
  const model = await loadOfflineModel();
  const context = new AudioContext({ sampleRate: 16000 });
  const results: string[] = [];
  try {
    for (const agent of ['codex', 'puck', 'ambient']) {
      const response = await fetch(`/diagnostics/${agent}.wav`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const recognizer = new model.KaldiRecognizer(buffer.sampleRate, WAKE_GRAMMAR);
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
      const wake = detectWake(text.replace(/\[unk\]/g, '').trim());
      const expected = agent === 'codex' ? 'codex' : agent === 'puck' ? 'amp' : undefined;
      const passed = wake?.agent === expected;
      results.push(
        `${passed ? 'PASS' : 'FAIL'} · ${agent}: “${text}” (${expected ? 'wake phrase' : 'ordinary speech'})`,
      );
    }
    return results.join('\n');
  } finally {
    model.terminate();
    await context.close();
  }
}
