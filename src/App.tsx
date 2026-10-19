import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, setCsrf } from './api';
import { VoiceController, type VoiceView } from './voice/controller';
import { Speaker } from './voice/speaker';
import { checkOfflineSpeech } from './voice/selftest';
import { availableInterruptionPhrase } from '../shared/speech';
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
  const select = (agent: Agent, id?: string) => {
    const next = { ...selectedRef.current, [agent]: id };
    selectedRef.current = next;
    setSelected(next);
    const taskProject = stateRef.current?.tasks.find((t) => t.id === id)?.projectId;
    if (taskProject && stateRef.current?.projects.some((p) => p.id === taskProject)) {
      projectRef.current = taskProject;
      setProject(taskProject);
    }
  };
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    let stream: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const connect = () =>
      api('/bootstrap')
        .then(({ csrf, state }) => {
          if (cancelled) return;
          setCsrf(csrf);
          setFatal('');
          setState(state);
          setProject((current) =>
            state.projects.some((p: State['projects'][number]) => p.id === current)
              ? current
              : state.projects[0]?.id || '',
          );
          controller.current ||= new VoiceController({
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
            stream?.close();
            setOnline(false);
            controller.current?.end();
            retry = setTimeout(() => void connect(), 2500);
          };
          stream.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'state') setState(data.state);
              else if (data.type === 'announce')
                controller.current?.announce(data.text, data.agent, data.attention, data.taskId);
            } catch {
              /* Ignore a malformed event; next state repairs the view. */
            }
          };
        })
        .catch((error) => {
          if (cancelled) return;
          setOnline(false);
          setFatal(error.message);
          retry = setTimeout(() => void connect(), 5000);
        });
    void connect();
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      cancelled = true;
      stream?.close();
      clearTimeout(retry);
      clearTimeout(noticeTimer.current);
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
      if (voice.active) {
        await controller.current?.say(
          'Freewheel audio test. Your microphone can stop this reply while the agents keep working.',
        );
        return;
      }
      const speaker = new Speaker(() => state.settings, notify);
      await speaker.say('Freewheel audio test.');
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
    off: '',
    starting: 'Starting microphone…',
    listening: 'Listening',
    awake: `${voice.agent ? agentName(voice.agent) : 'Freewheel'} listening`,
    confirming: 'Confirm task',
    speaking: `${voice.agent ? agentName(voice.agent) : 'Freewheel'} speaking`,
    recording: 'Recording',
    transcribing: 'Transcribing…',
    error: 'Microphone unavailable',
  }[voice.phase];
  const phaseHint =
    voice.error ||
    {
      off: '',
      starting:
        state.settings.recognition === 'offline'
          ? 'Loading offline recognition…'
          : 'Allow microphone access in your browser.',
      listening: '',
      awake: '',
      confirming: 'Say “send it” or “cancel”.',
      speaking:
        voice.interruptReady && availableInterruptionPhrase(voice.spoken)
          ? `Say “${availableInterruptionPhrase(voice.spoken)}” to stop.`
          : '',
      recording: 'Pause to finish. 45-second limit.',
      transcribing: '',
      error: 'Check microphone permissions or change recognition in Connections.',
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
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'session', label: 'Session', icon: 'radio' },
              { id: 'connections', label: 'Connections', icon: 'settings' },
              { id: 'guide', label: 'Help', icon: 'book' },
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
          <span>{online ? 'Connected' : 'Reconnecting…'}</span>
        </div>
      </aside>
      <main>
        {!online && (
          <div className="connection-banner" role="alert">
            Disconnected. Listening stopped; agent tasks may still be running. Reconnecting…
          </div>
        )}
        {tab === 'session' && (
          <>
            <div className="page-heading">
              <h1>Session</h1>
              <div className="workspace">
                <label htmlFor="project">Project</label>
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
                      {voice.active ? 'Active' : 'Inactive'}
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
                  {voice.phase !== 'off' && (
                    <div className="console-copy" aria-live="polite">
                      <h2>{phaseTitle}</h2>
                      {phaseHint && <p>{phaseHint}</p>}
                    </div>
                  )}
                  <div className="ride-actions">
                    <button
                      className={`primary-button ride-button ${voice.active ? 'end' : ''}`}
                      disabled={!online || voice.phase === 'starting'}
                      onClick={() => void startRide()}
                    >
                      <Icon name={voice.active ? 'pause' : 'mic'} size={18} />
                      {voice.active ? 'Stop listening' : 'Start listening'}
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
                      <span>{voice.phase === 'speaking' ? 'Reply' : 'You'}</span>
                      <p>
                        {voice.phase === 'speaking' ? voice.spoken : voice.heard || 'Listening…'}
                      </p>
                    </div>
                  )}
                  <div className="console-bottom">
                    <span>
                      {state.settings.transcription === 'openai'
                        ? 'OpenAI transcription'
                        : state.settings.recognition === 'offline'
                          ? 'On-device recognition'
                          : 'Browser recognition'}
                    </span>
                    <button
                      className={`quiet-button ${state.settings.quiet ? 'enabled' : ''}`}
                      onClick={() => void update({ quiet: !state.settings.quiet })}
                    >
                      <span className="small-switch" />
                      {state.settings.quiet ? 'Quiet mode on' : 'Quiet mode off'}
                    </button>
                  </div>
                </section>
                <div className="agent-grid">
                  {(['amp', 'codex'] as const).map((agent) => {
                    const connection = state.connections[agent];
                    const manager = agent === 'amp' && state.settings.ampMode === 'puck';
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
                        {active && <p>{task.activity}</p>}
                        <div className="agent-bottom">
                          <span>
                            {manager
                              ? 'Puck manages your Amp threads'
                              : selected[agent]
                                ? 'Continuing conversation'
                                : 'New conversation'}
                          </span>
                          <button
                            className="icon-button"
                            aria-label={`Send a task to ${agentName(agent)}`}
                            disabled={
                              !connection.connected || (!!active && agent === 'amp' && !manager)
                            }
                            onClick={() => {
                              setExternal(undefined);
                              setComposer(agent);
                            }}
                          >
                            <Icon name="arrow" size={19} />
                          </button>
                        </div>
                        <div className="agent-tools">
                          {!manager && (
                            <button
                              onClick={() => void showThreads(agent)}
                              disabled={!connection.connected || busy === 'threads-' + agent}
                            >
                              {busy === 'threads-' + agent ? 'Loading…' : 'Conversations'}
                            </button>
                          )}
                          {active ? (
                            <button
                              onClick={() =>
                                void action('stop', () => api(`/tasks/${task.id}/stop`, {}))
                              }
                            >
                              {manager ? 'Stop waiting' : 'Stop task'}
                            </button>
                          ) : (
                            !manager &&
                            selected[agent] && (
                              <button onClick={() => select(agent, undefined)}>Start fresh</button>
                            )
                          )}
                          {active && agent === 'codex' && (
                            <button onClick={() => select(agent, undefined)}>
                              New conversation
                            </button>
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
                <p className="ride-note">Requires an open lid.</p>
              </div>
              <aside className="activity-panel">
                <div className="panel-heading">
                  <h2>Tasks</h2>
                  {running.length > 0 && <span>{running.length} active</span>}
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
                    <h3>No tasks</h3>
                    <button
                      className="text-button"
                      onClick={() => {
                        setExternal(undefined);
                        setComposer('codex');
                      }}
                    >
                      New task <Icon name="arrow" size={16} />
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
              placeholder="Task instructions"
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
            Resume idle conversations only. Codex requires the original project folder.
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
          <h2>Agents</h2>
        </div>
        <div className="settings-content">
          {(['codex', 'amp'] as const).map((agent) => (
            <div className="connection-row" key={agent}>
              <div className="connection-row-title">
                <span className={`channel-dot ${agent}`} />
                <h3>
                  {agent === 'amp' ? (state.settings.ampMode === 'puck' ? 'Puck' : 'Amp') : 'Codex'}
                </h3>
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
                    Uses your local login. To sign in: <code>codex login</code>.
                  </>
                ) : (
                  <>
                    {state.settings.ampMode === 'puck'
                      ? 'Your latest Puck conversation. Manages agents in Amp.'
                      : 'Direct coding through Amp CLI.'}
                  </>
                )}
              </p>
              {agent === 'amp' && (
                <label className="inline-setting">
                  Amp connection
                  <select
                    aria-label="Amp connection"
                    value={state.settings.ampMode}
                    disabled={active}
                    onChange={(e) =>
                      void update({ ampMode: e.target.value as Settings['ampMode'] })
                    }
                  >
                    <option value="puck">Puck manager</option>
                    <option value="cli">Direct Amp thread</option>
                  </select>
                </label>
              )}
              {agent === 'amp' && state.settings.ampMode === 'puck' && (
                <>
                  <button
                    className="secondary-button"
                    disabled={active || busy === 'puck-login'}
                    onClick={() =>
                      void action('puck-login', async () => {
                        const result = await api<{ url?: string }>('/puck/login', {});
                        if (result.url) window.location.assign(result.url);
                      })
                    }
                  >
                    Sign in to Puck
                  </button>
                  {state.connections.amp.connected && (
                    <button
                      className="text-button"
                      onClick={() => void action('puck-logout', () => api('/puck/logout', {}))}
                    >
                      Disconnect
                    </button>
                  )}
                  <p className="subtle">
                    {state.puckUpdates === 'watching'
                      ? 'Automatic replies connected.'
                      : state.puckUpdates === 'unavailable'
                        ? 'Automatic replies need Amp CLI signed into the same account.'
                        : 'Automatic replies use your local Amp login. Sign-in lasts until quit.'}
                  </p>
                </>
              )}
              {agent === 'amp' && state.settings.ampMode === 'cli' && (
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
                      placeholder={state.credentials.amp ? 'Token connected' : 'Access token'}
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
          <p>English</p>
        </div>
        <div className="settings-content">
          {active && <p className="info-box">Stop listening to change recognition.</p>}
          <div className="option-grid">
            <button
              disabled={active}
              className={`option ${state.settings.recognition === 'browser' ? 'chosen' : ''}`}
              onClick={() => void update({ recognition: 'browser' })}
            >
              <strong>
                Browser speech <span>No API key</span>
              </strong>
              <p>Chrome. Audio may go to its speech service.</p>
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
              <p>Offline. Wait for “go ahead” after the wake phrase.</p>
              <span className="selection-ring" />
            </button>
          </div>
          {!state.modelReady && (
            <div className="install-row">
              <button
                className="secondary-button"
                disabled={busy === 'model'}
                onClick={() =>
                  void action('model', async () => {
                    await api('/model', {});
                    notify('Model installed. Select “On this Mac”.');
                  })
                }
              >
                {busy === 'model' ? 'Downloading…' : 'Download local model · 40 MB'}
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
                {busy === 'selftest' ? 'Checking recognition…' : 'Test local recognition'}
              </button>
              <p className="subtle">Synthetic audio; microphone stays off.</p>
              {selftest && <pre>{selftest}</pre>}
            </div>
          )}
          <div className="setting-row">
            <div>
              <h3>Read back before sending</h3>
              <p>Confirm with “send it”.</p>
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
            {state.modelReady
              ? 'While listening, say “pause audio” to stop replies. Tasks keep running.'
              : 'Download the local model above to stop replies by voice.'}
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-intro">
          <h2>OpenAI audio</h2>
          <p>Optional. Billed separately.</p>
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
                placeholder={state.credentials.openai ? 'Key connected' : 'sk-…'}
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
            Voice and transcription. Coding uses Codex or Amp. Keys stay in memory until quit.
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
              <option value="openai">OpenAI · after the wake phrase</option>
            </select>
          </label>
          {state.settings.transcription === 'openai' && (
            <p className="subtle">
              Speak after “go ahead”; pause to send. Follow-ups and confirmations use OpenAI too.
            </p>
          )}
          <label className="inline-setting">
            Session budget
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
            Resets on restart. Not a provider billing cap; coding costs are separate.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-intro">
          <h2>History</h2>
        </div>
        <div className="settings-content">
          <p className="subtle">
            Last 200 tasks. Clearing leaves Amp and Codex conversations intact.
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
    ['Hey Puck / Hey Codex', 'Choose an agent.'],
    ['Send it / cancel', 'Confirm or discard a task.'],
    ['Status', 'Check running tasks.'],
    ['Say that again', 'Repeat the last update.'],
    ['Pause audio / stop speaking', 'Stop a reply; keep the agent working.'],
    ['Stop working', 'Stop the addressed agent.'],
    ['New task', 'Start a new conversation.'],
    ['Approve three / deny three', 'Answer Codex request 3.'],
    ['Quiet / speak again', 'Pause or resume completion announcements.'],
  ];
  return (
    <div className="guide-page">
      <div className="page-heading">
        <h1>Help</h1>
        <button className="secondary-button" onClick={onStart}>
          Back to session
        </button>
      </div>
      <section className="guide-section">
        <h2>Setup</h2>
        <p>
          Select your earphones in macOS Sound settings, choose a project, test sound, then start
          listening. Allow microphone access.
        </p>
      </section>
      <section className="guide-section">
        <h2>Commands</h2>
        <p>
          Say a wake phrase, wait for “go ahead,” then speak. You can follow up without a wake
          phrase during the configured window.
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
        <h2>Limits</h2>
        <div>
          <h3>Mac and microphone</h3>
          <p>
            Keep the lid open and the Mac ventilated. Screen locking, tab suspension and Bluetooth
            changes can stop recognition. Test your headset while stationary.
          </p>
        </div>
        <div>
          <h3>Tasks and permissions</h3>
          <p>
            Stopping listening leaves tasks running. Use “stop working” to cancel. Answer Codex
            approvals by number; review blocked Amp tasks in Amp.
          </p>
        </div>
        <div>
          <h3>Cost</h3>
          <p>
            Normal Codex limits and Amp credits apply. Browser/offline speech adds no API charge.
            Optional OpenAI audio: $0.003 per dictated minute and $15 per million spoken characters.
          </p>
          <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">
            OpenAI pricing
          </a>
        </div>
      </section>
    </div>
  );
}
