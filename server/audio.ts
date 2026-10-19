import type { Hub } from './hub.js';

export class AudioService {
  constructor(private hub: Hub) {}
  private reserve(cost: number) {
    if (!this.hub.secrets.openai)
      throw new Error('Add an OpenAI API key in Connections to use cloud audio.');
    if (this.hub.state.audioSpend + cost > this.hub.state.settings.audioBudget)
      throw new Error('Cloud audio budget reached. Raise it in Connections or use system voice.');
    this.hub.state.audioSpend += cost;
    this.hub.changed();
  }
  async speech(text: string) {
    const estimate = (text.length * 15) / 1000000;
    this.reserve(estimate);
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.hub.secrets.openai}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'nova',
        input: text,
        response_format: 'mp3',
        speed: this.hub.state.settings.rate,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `OpenAI speech failed (${response.status}). Check your API key and billing. System voice is still available.`,
      );
    return Buffer.from(await response.arrayBuffer());
  }
  async transcribe(bytes: Buffer, mime: string, duration: number) {
    this.reserve((duration / 60) * 0.0045);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: mime }),
      mime.includes('mp4') ? 'command.m4a' : 'command.webm',
    );
    form.append('model', 'gpt-transcribe');
    form.append('languages[]', 'en');
    for (const keyword of ['Puck', 'Codex', 'Amp', 'Freewheel', 'GitHub'])
      form.append('keywords[]', keyword);
    form.append(
      'prompt',
      'A software developer speaking to Amp or Codex through Freewheel. Terms: Puck, Codex, repository, pull request, GitHub.',
    );
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.hub.secrets.openai}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `Transcription failed (${response.status}). Check your API key and billing. Nothing was sent to an agent.`,
      );
    return (await response.json()) as { text: string };
  }
}
