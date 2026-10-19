import express from 'express';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { z } from 'zod';
import { Hub } from './hub.js';
import { localSecurity } from './security.js';
import { AudioService } from './audio.js';
import { dataDir } from './store.js';
import { installModel } from './model.js';
import type { ServerEvent } from '../shared/types.js';

const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be between 1024 and 65535.');
const app = express();
const hub = new Hub();
const audio = new AudioService(hub);
const { guard, session } = localSecurity(port);
app.disable('x-powered-by');
app.use(guard);
app.use('/api', session);
app.use('/api', express.json({ limit: '48kb' }));
const agent = z.enum(['amp', 'codex']);
const settings = z
  .object({
    ampMode: z.enum(['puck', 'cli']),
    recognition: z.enum(['browser', 'offline']),
    speech: z.enum(['system', 'openai']),
    voice: z.string().max(200),
    rate: z.number().min(0.75).max(1.5),
    confirmTasks: z.boolean(),
    followUpSeconds: z.number().min(0).max(30),
    quiet: z.boolean(),
    audioBudget: z.number().min(0).max(50),
    transcription: z.enum(['recognizer', 'openai']).optional(),
  })
  .partial();
app.get('/api/bootstrap', (_req, res) => res.json({ csrf: res.locals.csrf, state: hub.state }));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event: ServerEvent) => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: 'state', state: hub.state });
  hub.on('event', send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    hub.off('event', send);
  });
});
app.post('/api/puck/login', async (_req, res) => {
  try {
    res.json({ url: await hub.puck.beginLogin() });
  } catch {
    throw new Error('Puck sign-in could not start. Use port 4318 and try again.');
  }
});
app.post('/api/puck/logout', async (_req, res) => {
  await hub.disconnectPuck();
  res.json({ ok: true });
});
app.get('/puck/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const input = z
      .object({ code: z.string().min(1).max(4096), state: z.string().length(64) })
      .parse(req.query);
    await hub.puck.finishLogin(input.code, input.state);
    hub.state.settings.ampMode = 'puck';
    await hub.connect();
    res.redirect('/?puck=connected');
  } catch {
    res
      .status(400)
      .type('text/plain')
      .send('Puck sign-in failed or expired. Return to Freewheel Connections and try again.');
  }
});
app.post('/api/connect', async (_req, res) => {
  await hub.connect();
  res.json(hub.state);
});
app.post('/api/credentials', async (req, res) => {
  const input = z
    .object({ provider: z.enum(['amp', 'openai']), value: z.string().max(4096) })
    .parse(req.body);
  if (input.value.trim() && /\s/.test(input.value.trim()))
    throw new Error('An access token cannot contain whitespace.');
  hub.secrets[input.provider] = input.value.trim() || undefined;
  if (input.provider === 'openai' && input.value.trim()) {
    hub.state.settings.speech = 'openai';
    hub.state.settings.transcription = 'openai';
  }
  if (input.provider === 'openai' && !input.value.trim()) {
    hub.state.settings.speech = 'system';
    hub.state.settings.transcription = 'recognizer';
  }
  hub.changed();
  if (input.provider === 'amp') await hub.connect();
  res.json({ ok: true });
});
app.post('/api/settings', async (req, res) => {
  const input = settings.parse(req.body);
  if (
    input.ampMode &&
    hub.state.tasks.some((t) => t.agent === 'amp' && ['running', 'waiting'].includes(t.status))
  )
    throw new Error('Wait for the current Amp reply before changing its connection.');
  Object.assign(hub.state.settings, input);
  if (input.ampMode) await hub.connect();
  hub.changed();
  res.json(hub.state.settings);
});
app.post('/api/projects', async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      path: z.string().trim().min(1).max(1024),
    })
    .parse(req.body);
  if (!input.path.startsWith('/'))
    throw new Error('Use an absolute project path, for example /Users/you/Projects/app.');
  const path = await realpath(input.path);
  if (!(await stat(path)).isDirectory()) throw new Error('Choose a directory.');
  if (hub.state.projects.some((p) => p.path === path))
    throw new Error('That project is already added.');
  const project = { id: randomUUID(), name: input.name || basename(path), path };
  hub.state.projects.push(project);
  hub.changed();
  res.json(project);
});
app.get('/api/threads/:agent', async (req, res) =>
  res.json(await hub.threads(agent.parse(req.params.agent))),
);
app.post('/api/tasks', async (req, res) => {
  const input = z
    .object({
      agent,
      projectId: z.string(),
      prompt: z.string().trim().min(1).max(16000),
      continueTaskId: z.string().optional(),
      externalId: z
        .string()
        .regex(/^(?:T-)?[a-zA-Z0-9-]{8,100}$/)
        .optional(),
    })
    .parse(req.body);
  res.json(
    await hub.dispatch(
      input.agent,
      input.projectId,
      input.prompt,
      input.continueTaskId,
      input.externalId,
    ),
  );
});
app.post('/api/tasks/:id/stop', async (req, res) => {
  await hub.stop(String(req.params.id));
  res.json({ ok: true });
});
app.post('/api/approvals/:id', (req, res) => {
  const input = z
    .object({
      decision: z.enum(['accept', 'decline']),
      answers: z.record(z.string(), z.string().max(4000)).optional(),
    })
    .parse(req.body);
  hub.answer(String(req.params.id), input.decision, input.answers);
  res.json({ ok: true });
});
app.post('/api/awake', (req, res) => {
  hub.keepAwake(z.object({ enabled: z.boolean() }).parse(req.body).enabled);
  res.json({ awake: hub.state.awake });
});
app.post('/api/model', async (_req, res) => {
  await installModel();
  hub.state.modelReady = true;
  hub.changed();
  res.json({ ok: true });
});
app.get('/api/model', (_req, res) => {
  if (!hub.state.modelReady) {
    res.status(404).json({ error: 'Install offline recognition in Connections.' });
    return;
  }
  // Express ignores dot-directory ancestors unless the trusted directory is the root.
  res.sendFile('model.tar.gz', { root: dataDir, dotfiles: 'deny' });
});
app.post('/api/audio/speech', async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1).max(3000) }).parse(req.body);
  const data = await audio.speech(text);
  res.type('audio/mpeg').send(data);
});
app.post(
  '/api/audio/transcribe',
  express.raw({ type: ['audio/webm', 'audio/mp4', 'audio/ogg'], limit: '5mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('No audio was recorded.');
    const duration = z.coerce.number().min(0.1).max(60).parse(req.query.seconds);
    res.json(
      await audio.transcribe(req.body, String(req.headers['content-type']).split(';')[0], duration),
    );
  },
);
app.delete('/api/history', (_req, res) => {
  if (hub.state.tasks.some((t) => ['running', 'waiting'].includes(t.status)))
    throw new Error('Finish or stop active tasks before clearing history.');
  hub.state.tasks = [];
  hub.changed();
  res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown Freewheel endpoint.' }));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message =
    error instanceof z.ZodError
      ? 'Check the form values and try again.'
      : error.code === 'ENOENT'
        ? 'That path or program was not found.'
        : hub.clean(error.message || 'The request could not be completed.');
  res.status(error instanceof z.ZodError ? 400 : 400).json({ error: message });
});
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Freewheel is ready at http://127.0.0.1:${port}`);
  void hub.connect();
});
server.on('error', (error: any) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Set PORT to another local port.`
      : error.message,
  );
  hub.close();
  process.exit(1);
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  hub.close();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
