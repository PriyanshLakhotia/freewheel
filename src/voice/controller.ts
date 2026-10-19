import type { Agent, State, Task } from '../../shared/types';
import { agentName } from '../../shared/types';
import { detectWake, parseIntent, speechText } from '../../shared/speech';
import { api, transcribe } from '../api';
import { Recognition } from './recognition';
import { Speaker } from './speaker';
import { recordCommand } from './record';
export type VoicePhase =
  | 'off'
  | 'starting'
  | 'listening'
  | 'awake'
  | 'confirming'
  | 'speaking'
  | 'recording'
  | 'transcribing'
  | 'error';
export interface VoiceView {
  phase: VoicePhase;
  active: boolean;
  agent?: Agent;
  heard: string;
  spoken: string;
  level: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  interruptReady?: boolean;
}
interface Options {
  state: () => State;
  project: () => string;
  selected: (agent: Agent) => string | undefined;
  select: (agent: Agent, id?: string) => void;
  view: (view: VoiceView) => void;
  notice: (text: string) => void;
}
export class VoiceController {
  view: VoiceView = { phase: 'off', active: false, heard: '', spoken: '', level: 0 };
  private recognizer: Recognition;
  private speaker: Speaker;
  private awakeUntil = 0;
  private pending?: {
    agent: Agent;
    text: string;
    projectId: string;
    expires: number;
    continueTaskId?: string;
  };
  private last = '';
  private queue: { text: string; agent?: Agent }[] = [];
  private speaking = false;
  private epoch = 0;
  private outputGeneration = 0;
  private recording?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private lastHeard = { text: '', at: 0 };
  private handling = false;
  constructor(private options: Options) {
    this.speaker = new Speaker(() => options.state().settings, options.notice);
    this.recognizer = new Recognition({
      final: (text) => void this.hear(text),
      partial: (text) => {
        if (!this.speaking) {
          this.patch({ heard: text });
        }
      },
      error: (error) => {
        this.end();
        this.patch({ phase: 'error', error });
        options.notice(error);
      },
      level: (level) => this.patch({ level }),
      interrupt: () => {
        if (this.speaking) this.hush();
      },
      warning: options.notice,
    });
  }
  private patch(patch: Partial<VoiceView>) {
    this.view = { ...this.view, ...patch };
    this.options.view(this.view);
  }
  async start() {
    if (this.view.active) return;
    const epoch = ++this.epoch;
    this.patch({ active: true, phase: 'starting', error: undefined, heard: '' });
    try {
      if (
        this.options.state().settings.recognition === 'offline' &&
        !this.options.state().modelReady
      )
        throw new Error('Install the offline model in Connections first.');
      await this.recognizer.start(
        this.options.state().settings.recognition,
        this.options.state().modelReady,
      );
      if (epoch !== this.epoch) return;
      this.patch({
        phase: 'listening',
        startedAt: Date.now(),
        endedAt: undefined,
        interruptReady: this.recognizer.canInterrupt,
      });
      this.timer = setInterval(() => {
        if (this.pending && Date.now() > this.pending.expires) {
          this.pending = undefined;
          this.awakeUntil = 0;
        }
        if (
          ['awake', 'confirming'].includes(this.view.phase) &&
          Date.now() > this.awakeUntil &&
          !this.pending
        ) {
          this.recognizer.setCommandMode(false);
          this.patch({ phase: 'listening', agent: undefined, heard: '' });
        }
      }, 500);
      await this.say('Ready. Say hey Puck, or hey Codex.');
    } catch (error: any) {
      this.end();
      this.patch({
        phase: 'error',
        error:
          error.name === 'NotAllowedError'
            ? 'Allow microphone access in your browser and macOS settings, then start again.'
            : error.message,
      });
    }
  }
  end() {
    this.epoch++;
    this.outputGeneration++;
    this.recording?.abort();
    this.recording = undefined;
    clearInterval(this.timer);
    this.recognizer.stop();
    this.speaker.stop();
    this.queue = [];
    this.speaking = false;
    this.pending = undefined;
    this.awakeUntil = 0;
    this.patch({
      phase: 'off',
      active: false,
      agent: undefined,
      level: 0,
      heard: '',
      endedAt: Date.now(),
      interruptReady: false,
    });
  }
  hush() {
    const generation = ++this.outputGeneration;
    this.speaker.stop();
    this.queue = [];
    this.speaking = false;
    this.recognizer.suppress(true);
    this.awakeUntil = this.pending ? Date.now() + 20000 : 0;
    this.recognizer.setCommandMode(!!this.pending);
    this.patch({
      phase: this.view.active ? (this.pending ? 'confirming' : 'listening') : 'off',
      ...(!this.pending ? { agent: undefined } : {}),
    });
    // Flush the stop phrase and any speaker echo before admitting new commands.
    setTimeout(() => {
      if (generation === this.outputGeneration && this.view.active) this.recognizer.suppress(false);
    }, 250);
  }
  private earcon(agent: Agent) {
    const context = this.recognizer.context;
    if (!context) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = agent === 'amp' ? 440 : 660;
    gain.gain.setValueAtTime(0.04, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.13);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.14);
  }
  async say(text: string, agent?: Agent) {
    this.last = text;
    this.patch({ spoken: text });
    if (!this.view.active) return;
    const epoch = this.epoch;
    const generation = ++this.outputGeneration;
    this.speaking = true;
    this.recognizer.suppress(true);
    this.recognizer.setCommandMode(!!agent);
    this.recognizer.listenForInterruptions(speechText(text, 80));
    this.patch({ phase: 'speaking', ...(agent ? { agent } : {}) });
    try {
      await this.speaker.say(text);
    } catch (error: any) {
      this.options.notice(error.message);
    }
    if (epoch !== this.epoch || generation !== this.outputGeneration) return;
    this.speaking = false;
    this.recognizer.listenForInterruptions();
    // Allow output to decay before admitting microphone input.
    await new Promise((r) => setTimeout(r, 250));
    if (epoch !== this.epoch || generation !== this.outputGeneration) return;
    this.recognizer.suppress(false);
    this.awakeUntil =
      Date.now() + (this.pending ? 20000 : this.options.state().settings.followUpSeconds * 1000);
    this.patch({ phase: this.pending ? 'confirming' : this.view.agent ? 'awake' : 'listening' });
    this.flushQueue();
  }
  announce(text: string, agent?: Agent, attention = false) {
    if (!this.view.active || (this.options.state().settings.quiet && !attention)) return;
    this.queue.push({ text, agent });
    this.flushQueue();
  }
  private flushQueue() {
    if (this.speaking || this.recording || this.pending || this.handling || !this.view.active)
      return;
    const next = this.queue.shift();
    if (next) void this.say(next.text, next.agent);
  }
  async hear(raw: string) {
    if (!this.view.active || this.speaking || this.recording || this.handling || !raw.trim())
      return;
    const now = Date.now();
    if (this.lastHeard.text === raw && now - this.lastHeard.at < 1500) return;
    this.lastHeard = { text: raw, at: now };
    const wake = detectWake(raw);
    let agent = wake?.agent || (now < this.awakeUntil ? this.view.agent : undefined);
    if (!agent) return;
    this.handling = true;
    try {
      this.patch({ agent, heard: raw, phase: 'awake' });
      this.awakeUntil = now + 10000;
      if (wake) {
        this.earcon(agent);
        if (this.pending?.agent !== agent) this.pending = undefined;
      }
      const command = wake ? wake.command : raw;
      if (!command) {
        const output = this.outputGeneration + 1;
        await this.say(`${agentName(agent)}. Go ahead.`, agent);
        if (!this.view.active || output !== this.outputGeneration) return;
        // An explicit wake always opens a command window, even when automatic follow-ups are off.
        this.awakeUntil = Date.now() + 20000;
        this.recognizer.setCommandMode(true);
        if (this.options.state().settings.transcription === 'openai') await this.dictate(agent);
        return;
      }
      await this.handle(agent, command);
    } catch (error: any) {
      this.pending = undefined;
      this.options.notice(error.message);
      await this.say(error.message, agent);
    } finally {
      this.handling = false;
      this.flushQueue();
    }
  }
  private async handle(agent: Agent, command: string) {
    const intent = parseIntent(command);
    const state = this.options.state();
    if (intent.type === 'repeat') {
      await this.say(this.last || 'Nothing to repeat yet.', agent);
      return;
    }
    if (intent.type === 'cancel') {
      this.pending = undefined;
      await this.say('Cancelled. Nothing sent.', agent);
      return;
    }
    if (intent.type === 'status') {
      const running = state.tasks.filter((t) => ['running', 'waiting'].includes(t.status));
      await this.say(
        running.length
          ? running
              .map(
                (t) =>
                  `${agentName(t.agent)} is ${t.status === 'waiting' ? 'waiting for your answer' : t.activity.toLowerCase()}.`,
              )
              .join(' ')
          : 'Both agents are free. Give either one a task.',
        agent,
      );
      return;
    }
    if (intent.type === 'quiet' || intent.type === 'unquiet') {
      await api('/settings', { quiet: intent.type === 'quiet' });
      await this.say(
        intent.type === 'quiet'
          ? 'Quiet mode. I will hold completion announcements.'
          : 'Spoken updates are back on.',
        agent,
      );
      return;
    }
    if (intent.type === 'new') {
      this.options.select(agent, undefined);
      this.pending = undefined;
      await this.say(`${agentName(agent)}. Ready for a new task.`, agent);
      return;
    }
    if (intent.type === 'stop') {
      this.pending = undefined;
      const task = state.tasks.find(
        (t) => t.agent === agent && ['running', 'waiting'].includes(t.status),
      );
      if (task) {
        await api(`/tasks/${task.id}/stop`, {});
        await this.say(`${agentName(agent)} is stopping.`, agent);
      } else await this.say(`${agentName(agent)} is not working on anything.`, agent);
      return;
    }
    if (intent.type === 'approve' || intent.type === 'deny') {
      const request = state.approvals.find(
        (a) => a.number === intent.number && a.agent === agent && a.kind !== 'question',
      );
      if (!request) {
        await this.say('That approval is no longer waiting. Nothing approved.', agent);
        return;
      }
      await api(`/approvals/${request.id}`, {
        decision: intent.type === 'approve' ? 'accept' : 'decline',
      });
      await this.say(
        intent.type === 'approve'
          ? `Approved request ${intent.number}.`
          : `Denied request ${intent.number}.`,
        agent,
      );
      return;
    }
    const question = state.approvals.find((a) => a.agent === agent && a.kind === 'question');
    if (question && intent.type === 'task') {
      const questions = question.questions || [];
      if (questions.length !== 1) {
        await this.say(
          'There are multiple questions. Please review them in Freewheel when you stop.',
          agent,
        );
        return;
      }
      await api(`/approvals/${question.id}`, {
        decision: 'accept',
        answers: { [questions[0].id]: intent.text },
      });
      await this.say('Answer sent.', agent);
      return;
    }
    if (intent.type === 'send') {
      const pending = this.pending;
      if (!pending || pending.agent !== agent || pending.expires < Date.now()) {
        this.pending = undefined;
        await this.say('There is no task waiting to send.', agent);
        return;
      }
      this.pending = undefined;
      await this.send(pending.agent, pending.text, pending.projectId, pending.continueTaskId);
      return;
    }
    if (intent.type !== 'task') return;
    if (/^(yes|yeah|okay|ok|no)$/i.test(intent.text)) {
      await this.say(
        'For a task, say send it. For an approval, say approve and its number.',
        agent,
      );
      return;
    }
    if (this.options.state().settings.confirmTasks) {
      const projectId = this.options.project();
      this.pending = {
        agent,
        text: intent.text,
        projectId,
        continueTaskId: this.options.selected(agent),
        expires: Date.now() + 40000,
      };
      const project = state.projects.find((p) => p.id === projectId)?.name || 'your project';
      await this.say(
        `${agentName(agent)}, in ${project}. ${speechText(intent.text, 35)} Say send it, or cancel.`,
        agent,
      );
    } else
      await this.send(agent, intent.text, this.options.project(), this.options.selected(agent));
  }
  private async send(agent: Agent, prompt: string, projectId: string, continueTaskId?: string) {
    const task = await api<Task>('/tasks', { agent, projectId, prompt, continueTaskId });
    this.options.select(agent, task.id);
    await this.say(`${agentName(agent)} is on it.`, agent);
  }
  private async dictate(agent: Agent) {
    if (!this.recognizer.stream || !this.recognizer.context) return;
    const epoch = this.epoch;
    this.recording = new AbortController();
    this.recognizer.suppress(true);
    this.patch({ phase: 'recording', heard: '' });
    try {
      const { blob, seconds } = await recordCommand(
        this.recognizer.stream,
        this.recognizer.context,
        this.recording.signal,
      );
      this.patch({ phase: 'transcribing' });
      const text = await transcribe(blob, seconds);
      if (epoch !== this.epoch) return;
      this.recording = undefined;
      this.patch({ heard: text });
      if (text.trim()) await this.handle(agent, text);
      else await this.say('I did not catch that. Nothing sent.', agent);
    } finally {
      this.recording = undefined;
      if (epoch === this.epoch) {
        this.recognizer.suppress(false);
        if (['recording', 'transcribing'].includes(this.view.phase))
          this.patch({ phase: 'listening' });
      }
    }
  }
}
