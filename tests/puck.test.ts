import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { ampBinary } from '../server/adapters/amp.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PuckAuth,
  PuckAdapter,
  ampFetch,
  puckArguments,
  readPuckResult,
} from '../server/adapters/puck.js';
import {
  PuckUpdates,
  puckReplies,
  type PuckThread,
  type PuckMessage,
} from '../server/puck-updates.js';

const user = (text: string): PuckMessage => ({ role: 'user', content: [{ type: 'text', text }] });
const reply = (id: number, text: string): PuckMessage => ({
  role: 'assistant',
  messageId: id,
  state: { type: 'complete', stopReason: 'end_turn' },
  content: [{ type: 'text', text }],
});

test('Puck OAuth uses single-use state and rejects other credential destinations', async () => {
  const provider = new PuckAuth('http://127.0.0.1:4318/puck/callback');
  provider.begin();
  const state = provider.state();
  assert.throws(() => provider.consumeState('wrong'), /expired/);
  provider.consumeState(state);
  assert.throws(() => provider.consumeState(state), /expired/);
  provider.begin();
  provider.consumeState(provider.state());
  assert.throws(
    () => provider.redirectToAuthorization(new URL('https://example.com/')),
    /destination/,
  );
  await assert.rejects(
    ampFetch('https://example.com/mcp', { headers: { Authorization: 'Bearer fake' } }),
    /destination/,
  );
  assert.deepEqual(
    puckArguments(
      {
        name: 'puck',
        inputSchema: {
          type: 'object',
          properties: { action: { enum: ['send', 'read_reply'] }, params: { type: 'object' } },
          required: ['action', 'params'],
        },
      },
      'Hello',
    ),
    { action: 'send', params: { message: 'Hello' } },
  );
  assert.throws(
    () =>
      puckArguments(
        { name: 'puck', inputSchema: { type: 'object', required: ['other'] } },
        'Hello',
      ),
    /unsupported/,
  );
});

test('Puck sends once, polls each reply handle, and pins its manager conversation', async (t) => {
  const id = 'T-00000000-0000-0000-0000-000000000001';
  const requests: any[] = [];
  const pending = new Map<string, string>();
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    assert.equal(String(url), 'https://ampcode.com/mcp');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer amp-oauth-fixture');
    if (options.method === 'GET') return new Response(null, { status: 405 });
    const request = JSON.parse(options.body);
    if (request.id === undefined) return new Response(null, { status: 202 });
    let result: any;
    if (request.method === 'initialize')
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      };
    else if (request.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'puck',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['send', 'read_reply'] },
                params: { type: 'object' },
              },
              required: ['action', 'params'],
            },
          },
        ],
      };
    else {
      const args = request.params.arguments;
      requests.push(args);
      const handle =
        args.action === 'send'
          ? `v1:${id}:M-${String(pending.size + 1).padStart(22, '0')}`
          : args.params.replyHandle;
      if (args.action === 'send') pending.set(handle, args.params.message);
      else assert(pending.has(handle));
      const response = {
        conversationID: id,
        url: `https://ampcode.com/threads/${id}`,
        replyHandle: handle,
        status: args.action === 'send' ? 'queued' : 'replied',
        reply: args.action === 'send' ? null : `Reply to ${pending.get(handle)}`,
      };
      // Real MCP responses carry JSON text, not the assistant's plain reply.
      result = { content: [{ type: 'text', text: JSON.stringify(response) }] };
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  const adapter = new PuckAdapter(4318, 0);
  adapter.auth.saveTokens({
    access_token: 'amp-oauth-fixture',
    token_type: 'Bearer',
    issuer: 'https://auth.ampcode.com',
  });
  try {
    const result = await Promise.all([
      adapter.send('First task', new AbortController().signal),
      adapter.send('Second task', new AbortController().signal),
    ]);
    assert.deepEqual(
      result.map((r) => r.reply),
      ['Reply to First task', 'Reply to Second task'],
    );
    assert.equal(requests.filter((r) => r.action === 'send').length, 2);
    assert.equal(
      new Set(requests.filter((r) => r.action === 'read_reply').map((r) => r.params.replyHandle))
        .size,
      2,
    );
    await adapter.send('Follow-up', new AbortController().signal);
    assert.equal(requests.find((r) => r.params.message === 'Follow-up').params.conversationID, id);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(adapter.send('Cancelled', controller.signal));
    assert(!requests.some((r) => r.params.message === 'Cancelled'));
    assert.throws(
      () =>
        readPuckResult({
          structuredContent: { ...result[0], conversationID: id.replace(/1$/, '2') },
        }),
      /unexpected/,
    );
  } finally {
    await adapter.close();
  }
});

test('Puck updates read only new completed replies and deduplicate repeated snapshots', async () => {
  const marker = 'freewheel-request';
  const thread: PuckThread = {
    id: 'T-puck',
    agentMode: 'puck',
    messages: [reply(1, 'Old reply'), user(marker), reply(2, 'Started two agents.')],
  };
  const spoken: string[] = [];
  let ready = false;
  const updates = new PuckUpdates(
    { readPuck: async () => thread },
    (text) => spoken.push(text),
    (value) => (ready = value),
  );
  try {
    assert.equal(await updates.bind(marker, thread.id), true);
    assert.equal(ready, true);
    await updates.poll();
    assert.deepEqual(spoken, ['Started two agents.']);
    thread.messages.push({ ...reply(3, 'Still generating'), state: { type: 'streaming' } });
    await updates.poll();
    assert.equal(spoken.length, 1);
    thread.messages[3] = reply(3, 'The second agent finished first.');
    await updates.poll();
    thread.messages.push(reply(4, 'The first agent finished.'));
    await updates.poll();
    assert.deepEqual(spoken, [
      'Started two agents.',
      'The second agent finished first.',
      'The first agent finished.',
    ]);
    assert.throws(
      () => puckReplies({ ...thread, agentMode: 'medium' }, marker, new Set()),
      /not a Puck/,
    );
    assert.throws(() => puckReplies(thread, 'unrelated-request', new Set()), /matched/);
    updates.close();
    await updates.poll();
    assert.equal(spoken.length, 3);
  } finally {
    updates.close();
  }
});

test('Puck watcher recovers failed reads without repeating fallback speech and handles reversed binding order', async () => {
  const thread: PuckThread = {
    id: 'T-puck',
    agentMode: 'puck',
    messages: [
      user('first-marker'),
      reply(1, 'First reply'),
      user('second-marker'),
      reply(2, 'Second reply'),
    ],
  };
  const spoken: string[] = [];
  let fail = false;
  const updates = new PuckUpdates(
    {
      readPuck: async () => {
        if (fail) throw new Error('offline');
        return thread;
      },
    },
    (text) => spoken.push(text),
    () => {},
  );
  try {
    await updates.bind('second-marker', thread.id);
    await updates.bind('first-marker', thread.id);
    assert.deepEqual(spoken, ['Second reply', 'First reply']);
    fail = true;
    thread.messages.push(user('third-marker'), reply(3, 'Fallback reply'));
    assert.equal(await updates.bind('third-marker', thread.id, 'Fallback reply'), false);
    fail = false;
    thread.messages.push(reply(4, 'Agent finished later'));
    await updates.poll();
    await updates.poll();
    assert.deepEqual(spoken, ['Second reply', 'First reply', 'Agent finished later']);
  } finally {
    updates.close();
  }
});

test('Amp uses the installed CLI rather than an npm ancestor binary', () => {
  const root = mkdtempSync(join(tmpdir(), 'freewheel-amp-'));
  try {
    const stale = join(root, 'node_modules', '.bin');
    const installed = join(root, 'bin');
    for (const dir of [stale, installed]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, process.platform === 'win32' ? 'amp.cmd' : 'amp'), '', {
        mode: 0o755,
      });
    }
    assert.equal(
      ampBinary({ PATH: [stale, installed].join(delimiter) }),
      join(installed, process.platform === 'win32' ? 'amp.cmd' : 'amp'),
    );
    assert.equal(ampBinary({ FREEWHEEL_AMP_BIN: '/explicit/amp' }), '/explicit/amp');
  } finally {
    rmSync(root, { recursive: true });
  }
});
