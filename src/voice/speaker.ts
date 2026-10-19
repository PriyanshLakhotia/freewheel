import { speechAudio } from '../api';
import { speechText } from '../../shared/speech';
import type { Settings } from '../../shared/types';
export class Speaker {
  private audio?: HTMLAudioElement;
  private generation = 0;
  private finish?: () => void;
  constructor(
    private settings: () => Settings,
    private onFallback: (text: string) => void,
  ) {}
  stop() {
    this.generation++;
    this.audio?.pause();
    this.audio = undefined;
    window.speechSynthesis?.cancel();
    this.finish?.();
    this.finish = undefined;
  }
  async say(text: string) {
    this.stop();
    const generation = this.generation;
    const spoken = speechText(text, 80);
    if (this.settings().speech === 'openai') {
      try {
        const blob = await speechAudio(spoken);
        if (generation !== this.generation) return;
        const url = URL.createObjectURL(blob);
        const audio = (this.audio = new Audio(url));
        audio.preload = 'auto';
        try {
          await new Promise<void>((resolve, reject) => {
            this.finish = resolve;
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error('Audio playback failed'));
            void audio.play().catch(reject);
          });
          return;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        if (generation !== this.generation) return;
        this.onFallback('Cloud voice is unavailable. Using your system voice.');
      }
    }
    if (!window.speechSynthesis) throw new Error('Speech playback is unavailable in this browser.');
    const settings = this.settings();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.rate = settings.rate;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((v) => v.voiceURI === settings.voice) ||
      voices.find((v) => v.lang.startsWith('en') && v.localService) ||
      null;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 35000);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.finish = done;
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });
  }
}
