import test from 'node:test';
import assert from 'node:assert/strict';
import { PuckAuth, PuckAdapter, ampFetch, puckArguments } from '../server/adapters/puck.js';
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
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      },
      'Hello',
    ),
    { message: 'Hello' },
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

test('Puck uses the authenticated MCP tool and accepts concurrent messages', async (t) => {
  const messages: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
    assert.equal(String(url), 'https://ampcode.com/mcp');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer amp-oauth-fixture');
    if (options.method === 'GET') return new Response(null, { status: 405 });
    const request = JSON.parse(options.body);
    if (request.id === undefined) return new Response(null, { status: 202 });
    const result =
      request.method === 'initialize'
        ? {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : request.method === 'tools/list'
          ? {
              tools: [
                {
                  name: 'puck',
                  inputSchema: {
                    type: 'object',
                    properties: { message: { type: 'string' } },
                    required: ['message'],
                  },
                },
              ],
            }
          : (messages.push(request.params.arguments.message),
            { content: [{ type: 'text', text: `Reply to ${request.params.arguments.message}` }] });
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  const adapter = new PuckAdapter();
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
    assert.deepEqual(result, ['Reply to First task', 'Reply to Second task']);
    assert.deepEqual(messages, ['First task', 'Second task']);
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
    { findPuck: async () => thread.id, readPuck: async () => thread },
    (text) => spoken.push(text),
    (value) => (ready = value),
  );
  try {
    assert.equal(await updates.bind(marker), true);
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
