import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, setCsrf } from './api';
import { VoiceController, type VoiceView } from './voice/controller';
import { Speaker } from './voice/speaker';
import { checkOfflineSpeech } from './voice/selftest';
import { Icon, Wheel } from './components/Icons';
import { Dialog } from './components/Dialog';
import {
  agentName,
  type Agent,
  type Approval,
  type Settings,
  type State,
  type Task,
  type ThreadChoice,
} from '../shared/types';

const initialVoice: VoiceView = { phase: 'off', active: false, heard: '', spoken: '', level: 0 };
const time = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export default function App() {
  const [state, setState] = useState<State>();
  const [tab, setTab] = useState<'session' | 'connections' | 'guide'>('session');
  const [voice, setVoice] = useState(initialVoice);
  const [project, setProject] = useState('');
  const [selected, setSelected] = useState<Partial<Record<Agent, string>>>({});
  const [notice, setNotice] = useState('');
  const [fatal, setFatal] = useState('');
  const [online, setOnline] = useState(true);
  const [projectDialog, setProjectDialog] = useState(false);
  const [composer, setComposer] = useState<Agent>();
  const [inspect, setInspect] = useState<string>();
  const [threads, setThreads] = useState<{ agent: Agent; items: ThreadChoice[] } | null>(null);
  const [external, setExternal] = useState<{ agent: Agent; id: string; title: string }>();
  const [clock, setClock] = useState(Date.now());
  const [busy, setBusy] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const projectRef = useRef(project);
  projectRef.current = project;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const controller = useRef<VoiceController | undefined>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = (text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 7000);
  };
  const select = (agent: Agent, id?: string) => setSelected((s) => ({ ...s, [agent]: id }));
  useEffect(() => {
    let stream: EventSource | undefined;
    let cancelled = false;
    api('/bootstrap')
      .then(({ csrf, state }) => {
        if (cancelled) return;
        setCsrf(csrf);
        setState(state);
        setProject(state.projects[0]?.id || '');
        controller.current = new VoiceController({
          state: () => stateRef.current!,
          project: () => projectRef.current,
          selected: (agent) => selectedRef.current[agent],
          select,
          view: setVoice,
          notice: notify,
        });
        stream = new EventSource('/api/events');
        stream.onopen = () => setOnline(true);
        stream.onerror = () => {
          setOnline(false);
          controller.current?.end();
        };
        stream.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'state') setState(data.state);
            else if (data.type === 'announce')
              controller.current?.announce(data.text, data.agent, data.attention);
          } catch {
            /* Ignore a malformed event; next state repairs the view. */
          }
        };
      })
      .catch((error) => setFatal(error.message));
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      cancelled = true;
      stream?.close();
      clearInterval(tick);
      controller.current?.end();
    };
  }, []);
  async function action(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    try {
      await run();
    } catch (error: any) {
      notify(error.message);
    } finally {
      setBusy('');
    }
  }
  async function update(patch: Partial<Settings>) {
    await action('settings', () => api('/settings', patch));
  }
  async function showThreads(agent: Agent) {
    await action('threads-' + agent, async () =>
      setThreads({ agent, items: await api<ThreadChoice[]>(`/threads/${agent}`) }),
    );
  }
  function changeProject(id: string) {
    setProject(id);
    setSelected({});
    setExternal(undefined);
    controller.current?.end();
  }
  async function startRide() {
    if (voice.active) {
      controller.current?.end();
      return;
    }
    await controller.current?.start();
  }
  async function testVoice() {
    if (!state) return;
    await action('test-voice', async () => {
      const speaker = new Speaker(() => state.settings, notify);
      await speaker.say('Freewheel is ready. Puck and Codex will keep their replies short.');
    });
  }
  if (!state)
    return (
      <div className="loading">
        <Wheel size={36} />
        <h1>Freewheel</h1>
        <p>{fatal || 'Connecting to your Mac…'}</p>
        {fatal && <button onClick={() => location.reload()}>Try again</button>}
      </div>
    );
  const currentProject = state.projects.find((p) => p.id === project);
  const inspected = state.tasks.find((t) => t.id === inspect);
  const running = state.tasks.filter((t) => ['running', 'waiting'].includes(t.status));
  const phaseTitle = {
    off: 'Ready when you are.',
    starting: 'Getting your mic ready.',
    listening: 'All ears.',
    awake: `${voice.agent ? agentName(voice.agent) : 'Freewheel'} is listening.`,
    confirming: 'Sound right?',
    speaking: `${voice.agent ? agentName(voice.agent) : 'Freewheel'} is speaking.`,
    recording: 'Go ahead. Take your time.',
    transcribing: 'Finding your words.',
    error: 'Let’s check your mic.',
  }[voice.phase];
  const phaseHint =
    voice.error ||
    {
      off: 'Your next task starts with a few words.',
      starting:
        state.settings.recognition === 'offline'
          ? 'Loading speech recognition on this Mac.'
          : 'Allow microphone access when your browser asks.',
      listening: 'Say “Hey Puck” or “Hey Codex”.',
      awake: 'Tell it what you need.',
      confirming: 'Say “send it” to begin, or “cancel”.',
      speaking: 'Short answers. The details stay here.',
      recording: 'Pause when you’re finished. Up to 45 seconds.',
      transcribing: 'Nothing has been sent to an agent yet.',
      error: 'Open Connections to choose another speech option.',
    }[voice.phase];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('session');
          }}
        >
          <Wheel />
          <span>freewheel</span>
        </a>
        <div className="sidebar-caption">Amp & Codex, by voice.</div>
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'session', label: 'Session', icon: 'radio' },
              { id: 'connections', label: 'Connections', icon: 'settings' },
              { id: 'guide', label: 'Field guide', icon: 'book' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.id === 'session' && voice.active && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`connection-dot ${online ? 'connected' : ''}`} />
          <span>{online ? 'On your Mac' : 'Reconnecting…'}</span>
          <p>
            Private by default.
            <br />
            Built for listening.
          </p>
          <span className="version">Freewheel 0.1</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            {tab === 'session'
              ? 'Your workspace'
              : tab === 'connections'
                ? 'Make yourself at home'
                : 'Before you head out'}
          </div>
          <div className="local-badge">
            <span className={`connection-dot ${online ? 'connected' : ''}`} />
            {online ? 'Local companion connected' : 'Companion disconnected'}
          </div>
        </header>
        {!online && (
          <div className="connection-banner" role="alert">
            Connection lost. Listening has stopped. Your agents may still be working. Reconnecting
            automatically.
          </div>
        )}
        {tab === 'session' && (
          <>
            <div className="page-heading">
              <div>
                <h1>Start a voice session.</h1>
                <p>Give them a task. Hear what happens next.</p>
              </div>
              <div className="workspace">
                <label htmlFor="project">Working in</label>
                <div>
                  <select
                    id="project"
                    value={project}
                    onChange={(e) => changeProject(e.target.value)}
                  >
                    {state.projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    aria-label="Add a project"
                    onClick={() => setProjectDialog(true)}
                  >
                    <Icon name="plus" size={17} />
                  </button>
                </div>
              </div>
            </div>
            <div className="workbench">
              <div className="primary-column">
                <section className={`console phase-${voice.phase}`} aria-label="Voice session">
                  <div className="console-top">
                    <span>
                      <span className={`connection-dot ${voice.active ? 'connected' : ''}`} />
                      {voice.active ? 'Ride in progress' : 'Off the clock'}
                    </span>
                    <span className="session-time">
                      {duration(
                        voice.startedAt
                          ? Math.max(
                              0,
                              ((voice.active ? clock : voice.endedAt || clock) - voice.startedAt) /
                                1000,
                            )
                          : 0,
                      )}
                    </span>
                  </div>
                  <div
                    className="instrument"
                    style={{ '--level': voice.level } as React.CSSProperties}
                  >
                    <svg className="dial" viewBox="0 0 260 260" aria-hidden="true">
                      <circle
                        cx="130"
                        cy="130"
                        r="114"
                        fill="none"
                        stroke="var(--line)"
                        strokeWidth="1"
                      />
                      {Array.from({ length: 72 }, (_, i) => {
                        const a = ((i * 5 - 90) * Math.PI) / 180;
                        const inner = i % 6 === 0 ? 96 : 102;
                        return (
                          <line
                            key={i}
                            x1={130 + Math.cos(a) * inner}
                            y1={130 + Math.sin(a) * inner}
                            x2={130 + Math.cos(a) * 108}
                            y2={130 + Math.sin(a) * 108}
                            className={i < Math.round(voice.level * 72) ? 'level-tick' : ''}
                            strokeWidth={i % 6 === 0 ? 1.5 : 1}
                          />
                        );
                      })}
                      <circle cx="130" cy="16" r="4" className="dial-marker" />
                    </svg>
                    <div className="instrument-core">
                      <div className="mic-symbol">
                        <Icon name={voice.phase === 'speaking' ? 'volume' : 'mic'} size={29} />
                      </div>
                      <span>
                        {voice.phase === 'speaking'
                          ? 'Speaking'
                          : voice.active
                            ? 'Mic is on'
                            : 'Mic is off'}
                      </span>
                      <div className="wave" aria-hidden="true">
                        {Array.from({ length: 7 }, (_, i) => (
                          <i
                            key={i}
                            style={{
                              height: voice.active
                                ? `${4 + voice.level * (12 + Math.sin(i * 1.8) * 12)}px`
                                : '3px',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="console-copy" aria-live="polite">
                    <h2>{phaseTitle}</h2>
                    <p>{phaseHint}</p>
                  </div>
                  <div className="ride-actions">
                    <button
                      className={`primary-button ride-button ${voice.active ? 'end' : ''}`}
                      disabled={!online || voice.phase === 'starting'}
                      onClick={() => void startRide()}
                    >
                      <Icon name={voice.active ? 'pause' : 'mic'} size={18} />
                      {voice.active ? 'End ride' : 'Start ride'}
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        void (voice.phase === 'speaking' ? controller.current?.hush() : testVoice())
                      }
                      disabled={busy === 'test-voice'}
                    >
                      {voice.phase === 'speaking'
                        ? 'Stop speaking'
                        : busy === 'test-voice'
                          ? 'Playing…'
                          : 'Test sound'}
                    </button>
                  </div>
                  <div className="wake-phrases">
                    <span
                      className={`wake-chip amp ${voice.agent === 'amp' && voice.active ? 'selected' : ''}`}
                    >
                      <span className="channel-dot" />
                      Hey Puck
                    </span>
                    <span
                      className={`wake-chip codex ${voice.agent === 'codex' && voice.active ? 'selected' : ''}`}
                    >
                      <span className="channel-dot" />
                      Hey Codex
                    </span>
                  </div>
                  {(voice.heard || voice.spoken) && voice.active && (
                    <div className="live-caption">
                      <span>{voice.phase === 'speaking' ? 'You’re hearing' : 'You said'}</span>
                      <p>
                        {voice.phase === 'speaking' ? voice.spoken : voice.heard || 'Listening…'}
                      </p>
                    </div>
                  )}
                  <div className="console-bottom">
                    <span>
                      {state.settings.recognition === 'offline'
                        ? 'On-device recognition'
                        : 'Browser recognition'}
                    </span>
                    <button
                      className={`quiet-button ${state.settings.quiet ? 'enabled' : ''}`}
                      onClick={() => void update({ quiet: !state.settings.quiet })}
                    >
                      <span className="small-switch" />
                      {state.settings.quiet ? 'Quiet mode on' : 'Spoken updates on'}
                    </button>
                  </div>
                </section>
                <div className="agent-grid">
                  {(['amp', 'codex'] as const).map((agent) => {
                    const connection = state.connections[agent];
                    const task = [...state.tasks]
                      .reverse()
                      .find((t) => t.agent === agent && t.projectId === project);
                    const active = task && ['running', 'waiting'].includes(task.status);
                    return (
                      <section className={`agent-channel ${agent}`} key={agent}>
                        <div className="agent-top">
                          <span className="agent-name">
                            <span className="channel-dot" />
                            {agentName(agent)}
                          </span>
                          <span className={`status-badge ${active ? 'working' : ''}`}>
                            {active
                              ? task.status === 'waiting'
                                ? 'Needs you'
                                : 'Working'
                              : connection.connected
                                ? 'Ready'
                                : 'Not connected'}
                          </span>
                        </div>
                        <p>
                          {active
                            ? task.activity
                            : agent === 'amp'
                              ? 'Your Amp coding agent.'
                              : 'Your Codex subscription.'}
                        </p>
                        <div className="agent-bottom">
                          <span>
                            {selected[agent] ? 'Continuing conversation' : 'New conversation'}
                          </span>
                          <button
                            className="icon-button"
                            aria-label={`Send a task to ${agentName(agent)}`}
                            disabled={!connection.connected || !!active}
                            onClick={() => {
                              setExternal(undefined);
                              setComposer(agent);
                            }}
                          >
                            <Icon name="arrow" size={19} />
                          </button>
                        </div>
                        <div className="agent-tools">
                          <button
                            onClick={() => void showThreads(agent)}
                            disabled={!connection.connected || busy === 'threads-' + agent}
                          >
                            {busy === 'threads-' + agent ? 'Loading…' : 'Open a conversation'}
                          </button>
                          {active ? (
                            <button
                              onClick={() =>
                                void action('stop', () => api(`/tasks/${task.id}/stop`, {}))
                              }
                            >
                              Stop task
                            </button>
                          ) : (
                            selected[agent] && (
                              <button onClick={() => select(agent, undefined)}>Start fresh</button>
                            )
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
                <div className="awake-row">
                  <div className="awake-label">
                    <span className={`connection-dot ${state.awake ? 'connected' : ''}`} />
                    <span>Keep this Mac awake</span>
                    <span className="subtle">
                      {state.awake
                        ? 'On until you turn it off or quit Freewheel'
                        : 'For the whole ride'}
                    </span>
                  </div>
                  <button
                    className={`switch ${state.awake ? 'on' : ''}`}
                    role="switch"
                    aria-checked={state.awake}
                    aria-label="Keep this Mac awake"
                    disabled={state.platform !== 'darwin' || busy === 'awake'}
                    onClick={() =>
                      void action('awake', () => api('/awake', { enabled: !state.awake }))
                    }
                  >
                    <span />
                  </button>
                </div>
                <p className="ride-note">
                  Keep the Mac open and ventilated. Set up audio before moving; keep your
                  surroundings audible.
                </p>
              </div>
              <aside className="activity-panel">
                <div className="panel-heading">
                  <h2>On the go</h2>
                  <span>{state.tasks.length ? `${running.length} active` : 'Activity'}</span>
                </div>
                {state.approvals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onError={notify} />
                ))}
                {!state.tasks.length ? (
                  <div className="empty-activity">
                    <div className="empty-line">
                      <span />
                      <span />
                      <span />
                    </div>
                    <h3>No tasks yet.</h3>
                    <p>
                      Send your first task. You’ll hear when it’s done, and find the details here.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setExternal(undefined);
                        setComposer('codex');
                      }}
                    >
                      Type a task instead <Icon name="arrow" size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="activity-list">
                    {[...state.tasks].reverse().map((task) => (
                      <button
                        className={`activity-item ${task.status}`}
                        key={task.id}
                        onClick={() => setInspect(task.id)}
                      >
                        <div className="activity-meta">
                          <span>
                            <span className={`channel-dot ${task.agent}`} />
                            {agentName(task.agent)}
                          </span>
                          <time>{time(task.createdAt)}</time>
                        </div>
                        <h3>{task.prompt}</h3>
                        <p>
                          {task.status === 'running'
                            ? task.activity
                            : task.status === 'waiting'
                              ? 'Waiting for your answer'
                              : task.summary}
                        </p>
                        <span className="activity-status">
                          {task.status === 'completed' ? (
                            <>
                              <Icon name="check" size={13} />
                              Done
                            </>
                          ) : task.status === 'error' ? (
                            'Needs attention'
                          ) : task.status === 'stopped' ? (
                            'Stopped'
                          ) : task.status === 'waiting' ? (
                            'Needs you'
                          ) : (
                            'Working'
                          )}
                          <Icon name="arrow" size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="phrase-note">
                  <span>Try saying</span>
                  <p>“Hey Codex, take a look at the failing tests.”</p>
                  <button onClick={() => setTab('guide')}>
                    See voice commands <Icon name="arrow" size={15} />
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
        {tab === 'connections' && (
          <Connections
            state={state}
            active={voice.active}
            busy={busy}
            action={action}
            update={update}
            testVoice={testVoice}
            notify={notify}
          />
        )}
        {tab === 'guide' && <Guide onStart={() => setTab('session')} />}
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {projectDialog && (
        <Dialog title="Add a project" onClose={() => setProjectDialog(false)}>
          <p className="dialog-intro">
            Choose a folder on this Mac. Your agents will work in this directory.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void action('project', async () => {
                const p = await api('/projects', {
                  name: String(data.get('name')) || undefined,
                  path: data.get('path'),
                });
                changeProject(p.id);
                setProjectDialog(false);
              });
            }}
          >
            <label>
              Project name
              <input name="name" placeholder="My app" maxLength={80} />
            </label>
            <label>
              Folder path
              <input
                name="path"
                required
                placeholder="/Users/you/Projects/my-app"
                autoFocus
                autoComplete="off"
              />
            </label>
            <button className="primary-button" disabled={busy === 'project'}>
              {busy === 'project' ? 'Adding…' : 'Add project'}
            </button>
          </form>
        </Dialog>
      )}
      {composer && (
        <Dialog
          title={`${external ? 'Continue with' : 'Talk to'} ${agentName(composer)}`}
          onClose={() => {
            setComposer(undefined);
            setExternal(undefined);
          }}
        >
          <p className="dialog-intro">
            {external ? external.title : currentProject?.path}
            {!external && selected[composer] ? ' · Continuing the selected conversation' : ''}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const prompt = String(new FormData(form).get('prompt'));
              const agent = composer;
              void action('send', async () => {
                const task = await api<Task>('/tasks', {
                  agent,
                  projectId: project,
                  prompt,
                  ...(external ? { externalId: external.id } : { continueTaskId: selected[agent] }),
                });
                select(agent, task.id);
                setComposer(undefined);
                setExternal(undefined);
                notify(`${agentName(agent)} is on it.`);
              });
            }}
          >
            <label className="sr-only" htmlFor="task-prompt">
              What should the agent do?
            </label>
            <textarea
              id="task-prompt"
              name="prompt"
              required
              autoFocus
              rows={5}
              maxLength={16000}
              placeholder="What would you like to get done?"
            />
            <div className="form-footer">
              <span>Uses your {composer === 'amp' ? 'Amp account' : 'Codex plan'}.</span>
              <button
                className="primary-button"
                disabled={busy === 'send' || !state.connections[composer].connected}
              >
                {busy === 'send' ? 'Sending…' : 'Send task'}
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {threads && (
        <Dialog
          title={`${agentName(threads.agent)} conversations`}
          onClose={() => setThreads(null)}
        >
          <p className="dialog-intro">
            Continue an idle conversation. For Codex, choose the same project folder and finish any
            turn running in the desktop app first.
          </p>
          <div className="thread-list">
            {threads.items.length ? (
              threads.items.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => {
                    setExternal({ agent: threads.agent, id: thread.id, title: thread.title });
                    setComposer(threads.agent);
                    setThreads(null);
                  }}
                >
                  <strong>{thread.title}</strong>
                  <span>{thread.cwd || thread.id}</span>
                  <Icon name="arrow" size={16} />
                </button>
              ))
            ) : (
              <p>No conversations found for this account.</p>
            )}
          </div>
        </Dialog>
      )}
      {inspected && (
        <Dialog
          title={`${agentName(inspected.agent)} · Task details`}
          onClose={() => setInspect(undefined)}
          wide
        >
          <div className="task-details">
            <span className="detail-status">
              {inspected.status} · {time(inspected.createdAt)}
            </span>
            <h3>{inspected.prompt}</h3>
            {inspected.error && <p className="error-box">{inspected.error}</p>}
            <pre>{inspected.output || inspected.activity}</pre>
            <div className="form-footer">
              <span>
                {inspected.externalId && inspected.agent === 'amp' ? (
                  <a
                    href={`https://ampcode.com/threads/${encodeURIComponent(inspected.externalId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Amp
                  </a>
                ) : inspected.externalId ? (
                  'Saved in your local Codex history'
                ) : (
                  ''
                )}
              </span>
              <button
                className="primary-button"
                disabled={['running', 'waiting'].includes(inspected.status)}
                onClick={() => {
                  setProject(inspected.projectId);
                  select(inspected.agent, inspected.id);
                  setInspect(undefined);
                  setExternal(undefined);
                  setComposer(inspected.agent);
                }}
              >
                Follow up
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  onError,
}: {
  approval: Approval;
  onError: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function answer(decision: 'accept' | 'decline', answers?: Record<string, string>) {
    setBusy(true);
    try {
      await api(`/approvals/${approval.id}`, { decision, answers });
    } catch (error: any) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="approval-card">
      <span className="approval-label">
        Codex needs you {approval.kind !== 'question' && `· Request ${approval.number}`}
      </span>
      <h3>{approval.title}</h3>
      <pre>{approval.detail}</pre>
      {approval.kind === 'question' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void answer(
              'accept',
              Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>,
            );
          }}
        >
          {approval.questions?.map((q) => (
            <label key={q.id}>
              {q.question}
              {q.options?.length ? (
                <select name={q.id} required>
                  {q.options.map((o) => (
                    <option key={o.label} value={o.label}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input name={q.id} required />
              )}
            </label>
          ))}
          <button className="primary-button" disabled={busy}>
            Send answer
          </button>
        </form>
      ) : (
        <>
          <div className="approval-buttons">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void answer('accept')}
            >
              Approve {approval.number}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void answer('decline')}
            >
              Deny
            </button>
          </div>
          <p className="approval-hint">Or say “Hey Codex, approve {approval.number}.”</p>
        </>
      )}
    </section>
  );
}

function Connections({
  state,
  active,
  busy,
  action,
  update,
  testVoice,
  notify,
}: {
  state: State;
  active: boolean;
  busy: string;
  action: (key: string, run: () => Promise<unknown>) => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  testVoice: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [selftest, setSelftest] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ampKey, setAmpKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  useEffect(() => {
    const load = () =>
      setVoices(window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith('en')) || []);
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);
  async function credential(provider: 'amp' | 'openai', value: string) {
    await action('key-' + provider, async () => {
      await api('/credentials', { provider, value });
      provider === 'amp' ? setAmpKey('') : setOpenaiKey('');
      notify(
        value
          ? 'Credential connected for this companion session.'
          : 'Credential removed from this companion session.',
      );
    });
  }
  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <h1>Connections</h1>
          <p>Your agents and audio, set up on this Mac.</p>
        </div>
        <button
          className="secondary-button"
          disabled={busy === 'connect'}
          onClick={() => void action('connect', () => api('/connect', {}))}
        >
          {busy === 'connect' ? 'Checking…' : 'Check connections'}
        </button>
      </div>
      <section className="settings-section">
        <div className="section-intro">
          <h2>Your agents</h2>
          <p>Freewheel uses the accounts already connected on this Mac.</p>
        </div>
        <div className="settings-content">
          {(['codex', 'amp'] as const).map((agent) => (
            <div className="connection-row" key={agent}>
              <div className="connection-row-title">
                <span className={`channel-dot ${agent}`} />
                <h3>{agent === 'amp' ? 'Amp' : 'Codex'}</h3>
                <span
                  className={`status-badge ${state.connections[agent].connected ? 'good' : ''}`}
                >
                  {state.connections[agent].connected ? 'Connected' : 'Setup needed'}
                </span>
              </div>
              <p>{state.connections[agent].detail}</p>
              <p className="subtle">
                {agent === 'codex' ? (
                  <>
                    Uses <code>codex app-server</code> and your existing login. Run{' '}
                    <code>codex login</code> in Terminal if needed. You can resume saved local
                    conversations.
                  </>
                ) : (
                  <>
                    “Hey Puck” runs an Amp agent through the CLI. It is not Amp’s built-in Puck
                    assistant. Run <code>amp login</code>, or connect a token below.
                  </>
                )}
              </p>
              {agent === 'amp' && (
                <form
                  className="credential-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void credential('amp', ampKey);
                  }}
                >
                  <label htmlFor="amp-key">
                    Amp access token <span>Optional with CLI login</span>
                  </label>
                  <div>
                    <input
                      id="amp-key"
                      type="password"
                      value={ampKey}
                      onChange={(e) => setAmpKey(e.target.value)}
                      placeholder={
                        state.credentials.amp
                          ? 'Token connected for this session'
                          : 'Paste your Amp access token'
                      }
                      autoComplete="off"
                    />
                    <button className="secondary-button" disabled={!ampKey || busy === 'key-amp'}>
                      Connect
                    </button>
                    {state.credentials.amp && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => void credential('amp', '')}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-intro">
          <h2>Listening</h2>
          <p>Both options recognize “Hey Puck” and “Hey Codex”. English for now.</p>
        </div>
        <div className="settings-content">
          {active && <p className="info-box">End the ride before changing the listening engine.</p>}
          <div className="option-grid">
            <button
              disabled={active}
              className={`option ${state.settings.recognition === 'browser' ? 'chosen' : ''}`}
              onClick={() => void update({ recognition: 'browser' })}
            >
              <strong>
                Browser speech <span>No API key</span>
              </strong>
              <p>Ready to use in Chrome. Audio may be sent to your browser’s speech service.</p>
              <span className="selection-ring" />
            </button>
            <button
              disabled={active || !state.modelReady}
              className={`option ${state.settings.recognition === 'offline' ? 'chosen' : ''}`}
              onClick={() => void update({ recognition: 'offline' })}
            >
              <strong>
                On this Mac <span>No API key</span>
              </strong>
              <p>
                Vosk recognition runs in your browser. No audio leaves for recognition; accuracy
                varies.
              </p>
              <span className="selection-ring" />
            </button>
          </div>
          {!state.modelReady && (
            <div className="install-row">
              <p>A one-time 40 MB model download enables offline recognition.</p>
              <button
                className="secondary-button"
                disabled={busy === 'model'}
                onClick={() =>
                  void action('model', async () => {
                    await api('/model', {});
                    notify('Offline recognition is ready. Select “On this Mac” above.');
                  })
                }
              >
                {busy === 'model' ? 'Downloading model…' : 'Install offline speech'}
              </button>
            </div>
          )}
          {state.modelReady && (
            <div className="offline-check">
              <button
                className="text-button"
                disabled={busy === 'selftest' || active}
                onClick={() =>
                  void action('selftest', async () => {
                    try {
                      setSelftest(await checkOfflineSpeech());
                    } catch (error) {
                      setSelftest(error instanceof Error ? error.message : 'Offline check failed.');
                    }
                  })
                }
              >
                {busy === 'selftest' ? 'Checking recognition…' : 'Check offline recognition'}
              </button>
              <p className="subtle">
                Plays a synthetic sample into the recognizer. Does not access your microphone.
              </p>
              {selftest && <pre>{selftest}</pre>}
            </div>
          )}
          <div className="setting-row">
            <div>
              <h3>Read back before sending</h3>
              <p>Say “send it” after the task is read back to you.</p>
            </div>
            <button
              className={`switch ${state.settings.confirmTasks ? 'on' : ''}`}
              role="switch"
              aria-checked={state.settings.confirmTasks}
              aria-label="Read back before sending"
              onClick={() => void update({ confirmTasks: !state.settings.confirmTasks })}
            >
              <span />
            </button>
          </div>
          <label className="inline-setting">
            Follow-up window
            <select
              value={state.settings.followUpSeconds}
              onChange={(e) => void update({ followUpSeconds: Number(e.target.value) })}
            >
              <option value={0}>Always use a wake phrase</option>
              <option value={10}>10 seconds after a reply</option>
              <option value={20}>20 seconds after a reply</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-intro">
          <h2>Speaking</h2>
          <p>Brief answers, with the full result kept in the task details.</p>
        </div>
        <div className="settings-content">
          <label className="inline-setting">
            Voice
            <select
              value={state.settings.speech === 'openai' ? '__openai' : state.settings.voice}
              onChange={(e) =>
                void update(
                  e.target.value === '__openai'
                    ? { speech: 'openai' }
                    : { speech: 'system', voice: e.target.value },
                )
              }
            >
              <option value="">System default · no API key</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                  {v.localService ? ' · on device' : ''}
                </option>
              ))}
              <option value="__openai" disabled={!state.credentials.openai}>
                OpenAI Nova · paid API
              </option>
            </select>
          </label>
          <label className="inline-setting">
            Speaking pace
            <div className="range-field">
              <input
                aria-label="Speaking pace"
                type="range"
                min="0.75"
                max="1.5"
                step="0.05"
                value={state.settings.rate}
                onChange={(e) => void update({ rate: Number(e.target.value) })}
              />
              <span>{state.settings.rate.toFixed(2)}×</span>
            </div>
          </label>
          <button
            className="secondary-button"
            onClick={() => void testVoice()}
            disabled={busy === 'test-voice'}
          >
            <Icon name="volume" size={16} />
            Test sound
          </button>
          <p className="subtle">
            All voices are synthesized. Recognition pauses while Freewheel speaks, so it cannot hear
            its own replies. Keep answers short; use Stop speaking to interrupt playback.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-intro">
          <h2>Optional cloud audio</h2>
          <p>Separate from your ChatGPT subscription. Only pay for the audio you use.</p>
        </div>
        <div className="settings-content">
          <form
            className="credential-form"
            onSubmit={(e) => {
              e.preventDefault();
              void credential('openai', openaiKey);
            }}
          >
            <label htmlFor="openai-key">OpenAI API key</label>
            <div>
              <input
                id="openai-key"
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder={state.credentials.openai ? 'Key connected for this session' : 'sk-…'}
                autoComplete="off"
              />
              <button className="secondary-button" disabled={!openaiKey || busy === 'key-openai'}>
                Connect
              </button>
              {state.credentials.openai && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void credential('openai', '')}
                >
                  Remove
                </button>
              )}
            </div>
          </form>
          <p className="subtle">
            Keys stay in the companion’s memory until it quits. They are never saved in your
            browser, project, or task history.
          </p>
          <label className="inline-setting">
            Command transcription
            <select
              disabled={!state.credentials.openai || active}
              value={state.settings.transcription}
              onChange={(e) =>
                void update({ transcription: e.target.value as Settings['transcription'] })
              }
            >
              <option value="recognizer">Use the listening engine</option>
              <option value="openai">OpenAI after the wake phrase</option>
            </select>
          </label>
          <p className="subtle">
            With cloud transcription: say the wake phrase, wait for “go ahead,” then dictate. A
            pause ends the recording. Background listening still uses your selected engine.
          </p>
          <label className="inline-setting">
            Audio budget per companion session
            <div className="budget-field">
              <span>$</span>
              <input
                aria-label="Audio budget in dollars"
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={state.settings.audioBudget}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value) && value >= 0 && value <= 50)
                    void update({ audioBudget: value });
                }}
              />
            </div>
          </label>
          <div className="cost-line">
            <span>Estimated audio spend</span>
            <strong>
              ${state.audioSpend.toFixed(3)} / ${state.settings.audioBudget.toFixed(2)}
            </strong>
          </div>
          <p className="subtle">
            An app-side estimate, not a provider billing cap. Coding usage is separate. Set a
            spending limit in your OpenAI account too.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-intro">
          <h2>On this Mac</h2>
          <p>Your projects, settings and last 200 tasks are saved locally.</p>
        </div>
        <div className="settings-content">
          <p className="subtle">
            History is stored in <code>~/.local/share/freewheel</code>. Clearing it here does not
            delete your Amp or Codex conversations.
          </p>
          <button
            className="secondary-button"
            onClick={() => {
              if (
                window.confirm(
                  'Clear Freewheel’s local task history? Your Amp and Codex conversations will remain.',
                )
              )
                void action('clear', () => api('/history', undefined, 'DELETE'));
            }}
          >
            Clear local history
          </button>
        </div>
      </section>
    </div>
  );
}

function Guide({ onStart }: { onStart: () => void }) {
  const commands = [
    ['Hey Puck, …', 'Talk to your Amp agent.'],
    ['Hey Codex, …', 'Talk to Codex.'],
    ['Send it / cancel', 'Send or discard the task that was just read back.'],
    ['Status', 'Hear what your agents are working on.'],
    ['Say that again', 'Repeat the last spoken update.'],
    ['Stop working', 'Interrupt the addressed agent.'],
    ['New task', 'Start a fresh conversation on this channel.'],
    ['Approve three / deny three', 'Answer the matching Codex permission request.'],
    ['Quiet / speak again', 'Hold or resume completion announcements.'],
  ];
  return (
    <div className="guide-page">
      <div className="page-heading">
        <div>
          <h1>Using Freewheel</h1>
          <p>A few things to know before your first ride.</p>
        </div>
      </div>
      <section className="guide-start">
        <div>
          <h2>
            Set up at your desk.
            <br />
            Keep going by voice.
          </h2>
          <p>
            Connect your earphones to the Mac. Select them as the input and output in macOS Sound
            settings, choose a project, and test the sound. Start your ride and grant microphone
            access.
          </p>
          <button className="primary-button" onClick={onStart}>
            Back to session
            <Icon name="arrow" size={16} />
          </button>
        </div>
        <div className="example-conversation">
          <div>
            <span>You</span>
            <p>Hey Codex, look into why the checkout tests are failing.</p>
          </div>
          <div>
            <span>Codex</span>
            <p>In your project, investigate the failing checkout tests. Say send it, or cancel.</p>
          </div>
          <div>
            <span>You</span>
            <p>Send it.</p>
          </div>
          <small>Example conversation</small>
        </div>
      </section>
      <section className="guide-section">
        <h2>A small vocabulary goes a long way.</h2>
        <p>
          Start with a wake phrase. For a few seconds after a reply, you can answer the same agent
          without repeating its name.
        </p>
        <div className="command-table">
          {commands.map(([command, meaning]) => (
            <div key={command}>
              <span>“{command}”</span>
              <p>{meaning}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="guide-section practical">
        <h2>What to expect</h2>
        <div>
          <h3>Your subscriptions do the coding.</h3>
          <p>
            Codex uses your existing login and its usual plan limits. Amp uses your selected
            account, plan, model routing and credits. Freewheel adds no charge for browser or
            offline recognition and system voices.
          </p>
        </div>
        <div>
          <h3>Cloud speech is optional.</h3>
          <p>
            OpenAI mini transcription is estimated at $0.003 per recorded minute. Freewheel’s TTS-1
            voice is estimated at $15 per million characters. A ride with 15 minutes of dictated
            commands and 9,000 spoken characters is about $0.18 in audio, plus coding usage.
          </p>
          <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">
            OpenAI pricing
          </a>
        </div>
        <div>
          <h3>The Mac still needs to stay awake.</h3>
          <p>
            The switch keeps the display and system awake while Freewheel runs. It does not override
            lid-close sleep. Keep the lid open and the Mac ventilated, and use a reliable internet
            connection for your agents.
          </p>
        </div>
        <div>
          <h3>Voice is a conversation, not a background guarantee.</h3>
          <p>
            Browser recognition can stop when a tab is suspended. Freewheel retries, but locked
            screens, wind, Bluetooth changes and network loss need testing with your setup. Offline
            recognition avoids the browser speech service, but may mishear names or technical
            language. Keep read-back enabled.
          </p>
        </div>
        <div>
          <h3>Permissions remain yours.</h3>
          <p>
            Codex requests can be answered by number. Amp’s noninteractive CLI cannot present every
            permission prompt; a blocked task tells you to review it in Amp. Freewheel never enables
            an allow-all mode.
          </p>
        </div>
        <div>
          <h3>Prepare before moving.</h3>
          <p>
            Use a stationary bike for your first test. Outside, keep your surroundings audible and
            stop somewhere safe for anything that needs the screen. You can end listening without
            cancelling agents already working.
          </p>
        </div>
      </section>
    </div>
  );
}
