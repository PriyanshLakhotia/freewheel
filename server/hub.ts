import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RpcClient } from './rpc.js';
import { PuckAdapter } from './adapters/puck.js';
import { PuckUpdates } from './puck-updates.js';
import { AmpAdapter } from './adapters/amp.js';
import { dataDir, loadState, saveState } from './store.js';
import { extractBriefing, SPOKEN_INSTRUCTIONS } from '../shared/speech.js';
import {
  agentName,
  type Agent,
  type Approval,
  type ServerEvent,
  type State,
  type Task,
  type ThreadChoice,
} from '../shared/types.js';

export class Hub extends EventEmitter {
  state: State;
  secrets: { amp?: string; openai?: string } = {
    amp: process.env.AMP_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  codex = new RpcClient();
  amp = new AmpAdapter(() => this.secrets.amp);
  puck = new PuckAdapter(Number(process.env.PORT || 4318));
  private puckRequests = new Map<string, AbortController>();
  private puckUpdates = new PuckUpdates(
    this.amp,
    (text, threadId) => {
      const task: Task = {
        id: randomUUID(),
        agent: 'amp',
        transport: 'puck',
        projectId: '',
        prompt: 'Puck update',
        status: 'completed',
        externalId: threadId,
        output: this.clean(text).slice(-100000),
        summary: extractBriefing(this.clean(text)),
        activity: 'Update',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.addTask(task);
      this.finish(task, 'completed');
    },
    (ready) => {
      this.state.puckUpdates = ready ? 'watching' : 'unavailable';
      this.changed();
    },
  );
  private awakeProcess?: ChildProcess;
  private pending = new Map<string, { rpcId: number | string; method: string; params: any }>();
  private approvalNumber = 0;
  private closed = false;
  private saveTimer?: NodeJS.Timeout;
  private itemTexts = new Map<string, Map<string, string>>();
  private starting = new Set<Agent>();
  private stopping = new Set<string>();
  constructor(codex?: RpcClient) {
    super();
    if (codex) this.codex = codex;
    const saved = loadState();
    this.state = {
      ...saved,
      approvals: [],
      connections: {
        amp: { available: false, connected: false, detail: 'Checking Amp…' },
        codex: { available: false, connected: false, detail: 'Checking Codex…' },
      },
      credentials: { amp: !!this.secrets.amp, openai: !!this.secrets.openai },
      awake: false,
      platform: process.platform,
      modelReady: existsSync(join(dataDir, 'model.tar.gz')),
      audioSpend: 0,
    };
    this.codex.on('message', (message) => this.codexMessage(message));
    this.codex.on('disconnect', () => {
      this.state.connections.codex.connected = false;
      this.state.connections.codex.detail = 'Codex disconnected. Reconnect to continue.';
      for (const t of this.state.tasks)
        if (t.agent === 'codex' && ['running', 'waiting'].includes(t.status))
          this.finish(
            t,
            'error',
            'Codex disconnected. Your thread is saved; check it before retrying.',
          );
      this.changed();
    });
  }
  clean(text: string): string {
    let safe = text;
    for (const secret of Object.values(this.secrets))
      if (secret) safe = safe.split(secret).join('[redacted]');
    return safe.replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|sgamp_[a-zA-Z0-9_-]+)\b/g, '[redacted]');
  }
  changed() {
    if (this.closed) return;
    this.state.credentials = { amp: !!this.secrets.amp, openai: !!this.secrets.openai };
    this.emit('event', { type: 'state', state: this.state } satisfies ServerEvent);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveState(this.state), 200);
  }
  announce(text: string, agent?: Agent, attention = false, taskId?: string) {
    this.emit('event', {
      type: 'announce',
      attention,
      taskId,
      id: randomUUID(),
      agent,
      text: this.clean(text),
    } satisfies ServerEvent);
  }
  async connect() {
    await Promise.allSettled([
      (this.state.settings.ampMode === 'puck'
        ? this.puck
            .connect()
            .then(() => ({
              available: true,
              connected: true,
              detail: 'Connected to your Puck in Amp',
            }))
            .catch(() => ({ available: true, connected: false, detail: 'Sign in to Puck below' }))
        : this.amp.connection()
      ).then((c) => {
        this.state.connections.amp = c;
        this.changed();
      }),
      (async () => {
        try {
          await this.codex.start();
          const result = await this.codex.request('account/read', { refreshToken: false });
          this.state.connections.codex = {
            available: true,
            connected: result.account?.type === 'chatgpt',
            detail:
              result.account?.type === 'chatgpt'
                ? `ChatGPT ${result.account.planType || 'subscription'}`
                : 'Sign in to Codex with ChatGPT. API-key coding is disabled.',
          };
        } catch {
          this.state.connections.codex = {
            available: false,
            connected: false,
            detail: 'Install Codex CLI and run codex login',
          };
        }
        this.changed();
      })(),
    ]);
  }
  async disconnectPuck() {
    this.puckUpdates.close();
    this.state.puckUpdates = 'off';
    for (const [id, controller] of this.puckRequests) {
      controller.abort();
      const task = this.state.tasks.find((t) => t.id === id);
      if (task) {
        task.status = 'stopped';
        task.activity = 'Disconnected; check Puck for agent status.';
      }
    }
    await this.puck.close();
    await this.connect();
  }
  async threads(agent: Agent): Promise<ThreadChoice[]> {
    if (agent === 'amp') {
      if (this.state.settings.ampMode === 'puck') return [];
      return this.amp.threads();
    }
    await this.codex.start();
    const result = await this.codex.request('thread/list', {
      limit: 30,
      sortKey: 'updated_at',
      sourceKinds: ['cli', 'vscode', 'appServer'],
      archived: false,
    });
    return result.data.map((t: any) => ({
      id: t.id,
      title: t.name || t.preview || 'Untitled Codex thread',
      cwd: t.cwd,
      updatedAt: t.updatedAt,
    }));
  }
  async dispatch(
    agent: Agent,
    projectId: string,
    prompt: string,
    continueTaskId?: string,
    externalId?: string,
  ): Promise<Task> {
    if (!this.state.connections[agent].connected)
      throw new Error(`${agentName(agent)} is not connected. Open Connections first.`);
    const usingPuck = agent === 'amp' && this.state.settings.ampMode === 'puck';
    if (
      !usingPuck &&
      (this.starting.has(agent) ||
        (agent === 'amp' &&
          this.state.tasks.some(
            (t) => t.agent === agent && ['running', 'waiting'].includes(t.status),
          )))
    )
      throw new Error(
        `${agentName(agent)} is already working. Wait, or stop the current task first.`,
      );
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Choose a project first.');
    if (usingPuck) {
      continueTaskId = undefined;
      externalId = undefined;
    }
    const previous = continueTaskId
      ? this.state.tasks.find((t) => t.id === continueTaskId)
      : undefined;
    if (
      continueTaskId &&
      (!previous || previous.agent !== agent || previous.projectId !== projectId)
    )
      throw new Error('That conversation belongs to another agent or project.');
    let threadId = previous?.externalId || externalId;
    const activeThread =
      threadId &&
      this.state.tasks.find(
        (t) =>
          t.agent === agent &&
          t.externalId === threadId &&
          ['running', 'waiting'].includes(t.status),
      );
    if (activeThread) {
      if (agent !== 'codex' || !activeThread.turnId || activeThread.status === 'waiting')
        throw new Error(
          'This conversation is waiting or starting. Answer its pending request first.',
        );
      const account = await this.codex.request('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt')
        throw new Error('API-key coding is disabled. Sign in with ChatGPT.');
      await this.codex.request('turn/steer', {
        threadId,
        expectedTurnId: activeThread.turnId,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
      });
      activeThread.prompt = this.clean(`${activeThread.prompt}\n\nFollow-up: ${prompt}`);
      activeThread.activity = 'Follow-up sent';
      activeThread.updatedAt = Date.now();
      this.changed();
      return activeThread;
    }

    const task: Task = {
      id: randomUUID(),
      agent,
      transport: usingPuck ? 'puck' : 'cli',
      projectId,
      prompt: this.clean(prompt),
      status: 'running',
      externalId: threadId,
      output: '',
      summary: '',
      activity: 'Starting…',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.starting.add(agent);
    this.addTask(task);
    this.changed();
    try {
      const instructions = `${SPOKEN_INSTRUCTIONS}\n\nUser request:\n${prompt}`;
      if (usingPuck) {
        const controller = new AbortController();
        this.puckRequests.set(task.id, controller);
        const marker = `freewheel-${task.id}`;
        const message = `${SPOKEN_INSTRUCTIONS}

You are the user's Amp manager. Delegate long tasks to separate agents and stay available for more instructions. Bring back a brief update when each task finishes. Use existing projects and runners; clarify an ambiguous destination. The local folder ${project.path} (${project.name}) is context, not an orb path.
Freewheel request: ${marker}

User request:
${prompt}`;
        void this.puck
          .send(message, controller.signal)
          .then(async (reply) => {
            if (task.status !== 'running') return;
            task.externalId = reply.conversationID;
            task.output = this.clean(reply.reply!).slice(-100000);
            const watched = await this.puckUpdates.bind(marker, reply.conversationID, reply.reply!);
            if (task.status === 'running') this.finish(task, 'completed', undefined, !watched);
          })
          .catch(() => {
            if (task.status === 'running')
              this.finish(
                task,
                'error',
                'Puck did not return a reply. Check its conversation in Amp before retrying.',
              );
          })
          .finally(() => this.puckRequests.delete(task.id));
      } else if (agent === 'amp') {
        this.amp.run(
          task.id,
          project.path,
          instructions,
          threadId,
          (m) => this.ampMessage(task, m),
          (error) => {
            if (task.status === 'stopped' || task.status === 'error' || task.status === 'completed')
              return;
            if (error) this.finish(task, 'error', error.message);
            else this.finish(task, 'completed');
          },
        );
      } else {
        await this.codex.start();
        const account = await this.codex.request('account/read', { refreshToken: false });
        if (account.account?.type !== 'chatgpt') {
          this.state.connections.codex.connected = false;
          this.state.connections.codex.detail =
            'Sign in to Codex with ChatGPT. API-key coding is disabled.';
          throw new Error(this.state.connections.codex.detail);
        }
        const common = {
          cwd: project.path,
          modelProvider: 'openai',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          sandbox: 'workspace-write',
        };
        if (threadId) {
          const read = await this.codex.request('thread/read', { threadId, includeTurns: false });
          if (read.thread.cwd && read.thread.cwd !== project.path)
            throw new Error('Select the original project directory to continue this Codex thread.');
          if (read.thread.status?.type === 'active')
            throw new Error('This Codex thread is already active. Let its current turn finish.');
          await this.codex.request('thread/resume', { threadId, ...common });
        } else {
          const response = await this.codex.request('thread/start', {
            ...common,
            developerInstructions: SPOKEN_INSTRUCTIONS,
          });
          threadId = response.thread.id;
          task.externalId = threadId;
        }
        if (this.stopping.has(task.id)) {
          this.finish(task, 'stopped');
          return task;
        }
        const response = await this.codex.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: instructions, text_elements: [] }],
        });
        task.turnId = response.turn.id;
        if (this.stopping.has(task.id)) await this.stop(task.id);
      }
      task.activity = task.status === 'running' ? 'Working in ' + project.name : task.activity;
      this.changed();
      return task;
    } catch (error: any) {
      this.finish(task, 'error', error.message);
      throw error;
    } finally {
      this.starting.delete(agent);
    }
  }
  private ampMessage(task: Task, m: any) {
    if (task.status !== 'running') return;
    if (m.session_id) task.externalId = m.session_id;
    if (m.type === 'assistant')
      for (const part of m.message?.content || []) {
        if (part.type === 'text')
          task.output = this.clean((task.output + '\n' + part.text).trim()).slice(-100000);
        if (part.type === 'tool_use')
          task.activity = `Using ${part.name.replace(/^builtin:/, '').replace(/_/g, ' ')}`;
      }
    if (m.type === 'result') {
      if (m.result) task.output = this.clean(m.result).slice(-100000);
      if (m.is_error) this.finish(task, 'error', m.error || 'Amp could not finish this task.');
      else if (m.permission_denials?.length)
        this.finish(
          task,
          'error',
          'Amp needs permission for a tool. Open the Amp thread to review it, then continue here.',
        );
      else this.finish(task, 'completed');
    }
    task.updatedAt = Date.now();
    this.changed();
  }
  private codexMessage(message: any) {
    const p = message.params || {};
    const task = [...this.state.tasks]
      .reverse()
      .find(
        (t) =>
          t.agent === 'codex' &&
          t.externalId === p.threadId &&
          ['running', 'waiting'].includes(t.status),
      );
    if (message.id !== undefined && message.method) {
      if (!task) {
        this.codex.reject(message.id, 'No active Freewheel task owns this request');
        return;
      }
      if (
        [
          'item/commandExecution/requestApproval',
          'item/fileChange/requestApproval',
          'item/tool/requestUserInput',
        ].includes(message.method)
      ) {
        const kind = message.method.includes('commandExecution')
          ? 'command'
          : message.method.includes('fileChange')
            ? 'files'
            : 'question';
        const approval: Approval = {
          id: randomUUID(),
          number: ++this.approvalNumber,
          taskId: task.id,
          agent: 'codex',
          kind,
          title:
            kind === 'command'
              ? 'Run a command'
              : kind === 'files'
                ? 'Change files'
                : 'Codex has a question',
          detail: this.clean(
            p.command ||
              p.reason ||
              p.questions?.map((q: any) => q.question).join(' ') ||
              'Review this request in the transcript.',
          ),
          questions: p.questions,
          createdAt: Date.now(),
        };
        this.pending.set(approval.id, { rpcId: message.id, method: message.method, params: p });
        this.state.approvals.push(approval);
        task.status = 'waiting';
        task.activity = approval.title;
        this.announce(
          kind === 'question'
            ? `Codex asks: ${approval.detail}`
            : `Codex needs approval ${approval.number}. ${extractBriefing(approval.detail)} Say approve ${approval.number}, or deny ${approval.number}.`,
          'codex',
          true,
        );
        this.changed();
      } else if (message.method === 'item/permissions/requestApproval') {
        this.codex.respond(message.id, { permissions: {}, scope: 'turn' });
        this.announce(
          'Codex requested additional permissions. Review those in the Codex app.',
          'codex',
          true,
        );
      } else if (message.method === 'mcpServer/elicitation/request')
        this.codex.respond(message.id, { action: 'decline', content: null });
      else this.codex.reject(message.id, 'This request needs the Codex interface.');
      return;
    }
    if (message.method === 'serverRequest/resolved') {
      const entry = [...this.pending.entries()].find(([, v]) => v.rpcId === p.requestId);
      if (entry) this.removeApproval(entry[0]);
      return;
    }
    if (!task) return;
    if (p.turnId) task.turnId = p.turnId;
    if (message.method === 'turn/started') task.turnId = p.turn?.id;
    if (message.method === 'item/agentMessage/delta') {
      const items = this.itemTexts.get(task.id) || new Map<string, string>();
      items.set(p.itemId, (items.get(p.itemId) || '') + p.delta);
      this.itemTexts.set(task.id, items);
      task.output = this.clean([...items.values()].join('\n\n')).slice(-100000);
    }
    if (message.method === 'item/completed' && p.item?.type === 'agentMessage') {
      const items = this.itemTexts.get(task.id) || new Map<string, string>();
      items.set(p.item.id, p.item.text || '');
      this.itemTexts.set(task.id, items);
      task.output = this.clean([...items.values()].join('\n\n')).slice(-100000);
      if (!p.item.phase || p.item.phase === 'final_answer')
        task.summary = extractBriefing(p.item.text || '');
    }
    if (message.method === 'item/started')
      task.activity =
        (
          {
            commandExecution: 'Running a command',
            fileChange: 'Editing files',
            webSearch: 'Looking up information',
            mcpToolCall: 'Using a connected tool',
            agentMessage: 'Preparing a reply',
          } as Record<string, string>
        )[p.item?.type] || 'Working';
    if (message.method === 'turn/completed') {
      const turn = p.turn;
      this.finish(
        task,
        turn.status === 'completed'
          ? 'completed'
          : turn.status === 'interrupted'
            ? 'stopped'
            : 'error',
        turn.error?.message,
      );
    }
    if (message.method === 'error' && !p.willRetry)
      this.finish(task, 'error', p.error?.message || 'Codex reported an error.');
    task.updatedAt = Date.now();
    this.changed();
  }
  private addTask(task: Task) {
    this.state.tasks.push(task);
    while (this.state.tasks.length > 200) {
      const index = this.state.tasks.findIndex((t) => !['running', 'waiting'].includes(t.status));
      if (index < 0) break;
      this.state.tasks.splice(index, 1);
    }
  }
  private finish(task: Task, status: Task['status'], error?: string, announce = true) {
    task.status = status;
    task.updatedAt = Date.now();
    task.activity =
      status === 'completed' ? 'Finished' : status === 'stopped' ? 'Stopped' : 'Needs attention';
    if (error) {
      try {
        const parsed = JSON.parse(error);
        error = parsed.error?.message || parsed.message || error;
      } catch {}
      task.error = this.clean(error!).slice(0, 2000);
    }
    task.summary =
      status === 'completed'
        ? task.summary ||
          extractBriefing(task.output) ||
          'The agent finished without a spoken reply. Check the transcript.'
        : status === 'stopped'
          ? 'Stopped. The conversation is saved.'
          : extractBriefing(task.error || 'The task did not complete.');
    this.state.approvals
      .filter((a) => a.taskId === task.id)
      .forEach((a) => this.removeApproval(a.id));
    this.itemTexts.delete(task.id);
    this.stopping.delete(task.id);
    this.changed();
    if (announce)
      this.announce(
        `${agentName(task.agent)}. ${task.summary}`,
        task.agent,
        status === 'error',
        task.id,
      );
  }
  async stop(id: string) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task || !['running', 'waiting'].includes(task.status))
      throw new Error('That task is no longer running.');
    this.stopping.add(id);
    if (task.transport === 'puck') {
      this.puckRequests.get(id)?.abort();
      this.finish(task, 'stopped', undefined, false);
      task.summary = 'Stopped waiting for this reply. Puck and its agents may still be working.';
      this.changed();
    } else if (task.agent === 'amp') {
      this.amp.stop(id);
      this.finish(task, 'stopped');
    } else if (task.turnId && task.externalId) {
      await this.codex.request('turn/interrupt', {
        threadId: task.externalId,
        turnId: task.turnId,
      });
      this.finish(task, 'stopped');
    } else {
      task.activity = 'Stopping…';
      this.changed();
    }
  }
  answer(id: string, decision: 'accept' | 'decline', answers?: Record<string, string>) {
    const pending = this.pending.get(id);
    const approval = this.state.approvals.find((a) => a.id === id);
    if (!pending || !approval) throw new Error('That approval expired or was already answered.');
    const task = this.state.tasks.find((t) => t.id === approval.taskId);
    if (!task || task.status !== 'waiting') throw new Error('This task is no longer waiting.');
    if (approval.kind === 'question') {
      if (!answers || approval.questions?.some((q) => !answers[q.id]?.trim()))
        throw new Error('Answer each question before continuing.');
      this.codex.respond(pending.rpcId, {
        answers: Object.fromEntries(
          Object.entries(answers).map(([key, value]) => [key, { answers: [value] }]),
        ),
      });
    } else this.codex.respond(pending.rpcId, { decision });
    this.removeApproval(id);
    task.status = this.state.approvals.some((a) => a.taskId === task.id) ? 'waiting' : 'running';
    task.activity = 'Continuing';
    this.changed();
  }
  private removeApproval(id: string) {
    const approval = this.state.approvals.find((a) => a.id === id);
    this.pending.delete(id);
    this.state.approvals = this.state.approvals.filter((a) => a.id !== id);
    const task = this.state.tasks.find((t) => t.id === approval?.taskId);
    if (task?.status === 'waiting' && !this.state.approvals.some((a) => a.taskId === task.id)) {
      task.status = 'running';
      task.activity = 'Continuing';
    }
    this.changed();
  }
  keepAwake(enabled: boolean) {
    if (process.platform !== 'darwin' && enabled)
      throw new Error('Mac keep-awake is only available on macOS.');
    if (enabled && !this.awakeProcess) {
      const child = spawn('/usr/bin/caffeinate', ['-di', '-w', String(process.pid)], {
        stdio: 'ignore',
      });
      this.awakeProcess = child;
      child.on('error', () => {
        this.awakeProcess = undefined;
        this.state.awake = false;
        this.changed();
      });
      child.on('exit', () => {
        if (this.awakeProcess === child) {
          this.awakeProcess = undefined;
          this.state.awake = false;
          this.changed();
        }
      });
    } else if (!enabled) {
      this.awakeProcess?.kill();
      this.awakeProcess = undefined;
    }
    this.state.awake = enabled;
    this.changed();
  }
  close() {
    this.closed = true;
    this.awakeProcess?.kill();
    this.puckUpdates.close();
    for (const request of this.puckRequests.values()) request.abort();
    void this.puck.close();
    this.amp.close();
    this.codex.close();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    saveState(this.state);
  }
}
