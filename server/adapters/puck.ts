import { randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthTokens,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const endpoint = new URL('https://ampcode.com/mcp');
export const clientMetadataUrl =
  'https://raw.githubusercontent.com/PriyanshLakhotia/freewheel/main/docs/oauth/freewheel-client.json';
const allowedOrigins = new Set(['https://ampcode.com', 'https://auth.ampcode.com']);
export const ampFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!allowedOrigins.has(url.origin))
    throw new Error('Unexpected Amp authentication destination.');
  return fetch(input, { ...init, redirect: 'error' });
};

export class PuckAuth implements OAuthClientProvider {
  clientMetadataUrl = clientMetadataUrl;
  private token?: OAuthTokens;
  private client?: OAuthClientInformationMixed;
  private verifier = '';
  private nonce = '';
  private expires = 0;
  authorizationUrl?: string;
  constructor(public readonly redirectUrl: string) {}
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Freewheel',
      client_uri: 'https://github.com/PriyanshLakhotia/freewheel',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  begin() {
    this.nonce = randomBytes(32).toString('hex');
    this.expires = Date.now() + 10 * 60_000;
    this.authorizationUrl = undefined;
  }
  consumeState(state: string) {
    const expected = this.nonce;
    if (
      !expected ||
      Date.now() > this.expires ||
      state.length !== expected.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(expected))
    )
      throw new Error('Puck sign-in expired. Start again from Connections.');
    this.nonce = '';
  }
  state() {
    return this.nonce;
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.client = client;
  }
  tokens() {
    return this.token;
  }
  saveTokens(tokens: OAuthTokens) {
    this.token = tokens;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
  redirectToAuthorization(url: URL) {
    if (url.origin !== 'https://auth.ampcode.com')
      throw new Error('Unexpected Amp sign-in destination.');
    this.authorizationUrl = url.href;
  }
  invalidateCredentials(scope: string) {
    if (scope === 'all' || scope === 'tokens') this.token = undefined;
    if (scope === 'all' || scope === 'client') this.client = undefined;
    if (scope === 'all' || scope === 'verifier') this.verifier = '';
  }
}

export function puckArguments(
  tool: Tool,
  message: string,
  conversationID?: string,
): Record<string, unknown> {
  const properties = tool.inputSchema.properties || {};
  const actions = properties.action as { enum?: string[] } | undefined;
  if (
    !actions?.enum?.includes('send') ||
    !actions.enum.includes('read_reply') ||
    !properties.params
  )
    throw new Error('Puck has an unsupported input format. No message was sent.');
  return { action: 'send', params: { message, ...(conversationID ? { conversationID } : {}) } };
}

const conversationID = z
  .string()
  .regex(/^T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const puckReply = z.object({
  conversationID,
  replyHandle: z
    .string()
    .regex(/^v1:T-[0-9a-f-]{36}:M-[0-9A-Za-z]{22}$/)
    .nullable(),
  status: z.enum(['replied', 'working', 'queued', 'failed']),
  reply: z.string().nullable(),
});
export type PuckReply = z.infer<typeof puckReply>;
export function readPuckResult(input: unknown): PuckReply {
  const result = z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    })
    .parse(input);
  if (result.isError)
    throw new Error(
      'Puck could not complete this request. Check its conversation before retrying.',
    );
  const content = result.content;
  const text = content
    ?.filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('\n');
  const parsed = puckReply.parse(result.structuredContent ?? JSON.parse(text || '{}'));
  if (parsed.replyHandle && !parsed.replyHandle.startsWith(`v1:${parsed.conversationID}:`))
    throw new Error('Puck returned a reply for an unexpected conversation.');
  return parsed;
}

export class PuckAdapter {
  readonly auth: PuckAuth;
  private client?: Client;
  private connecting?: Promise<void>;
  private tool?: Tool;
  private conversationId?: string;
  constructor(
    port = 4318,
    private pollInterval = 2000,
  ) {
    this.auth = new PuckAuth(`http://127.0.0.1:${port}/puck/callback`);
  }
  get connected() {
    return !!this.client && !!this.tool;
  }
  async beginLogin() {
    if (this.auth.redirectUrl !== 'http://127.0.0.1:4318/puck/callback')
      throw new Error('Puck sign-in currently requires Freewheel on port 4318.');
    this.auth.begin();
    await auth(this.auth, {
      serverUrl: endpoint,
      resourceMetadataUrl: new URL('https://ampcode.com/.well-known/oauth-protected-resource/mcp'),
      fetchFn: ampFetch,
    });
    if (!this.auth.authorizationUrl) {
      await this.connect();
      return undefined;
    }
    return this.auth.authorizationUrl;
  }
  async finishLogin(code: string, state: string) {
    this.auth.consumeState(state);
    await auth(this.auth, { serverUrl: endpoint, authorizationCode: code, fetchFn: ampFetch });
    await this.connect();
  }
  async connect() {
    if (this.connected) return;
    if (!this.auth.tokens()) throw new Error('Sign in to Puck in Connections.');
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new Client({ name: 'Freewheel', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(endpoint, {
        authProvider: this.auth,
        fetch: ampFetch,
      });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'puck');
        if (!tool) throw new Error('Puck is unavailable for this Amp account.');
        puckArguments(tool, 'schema check');
        this.client = client;
        this.tool = tool;
        client.onclose = () => {
          if (this.client === client) {
            this.client = undefined;
            this.tool = undefined;
          }
        };
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  async send(message: string, signal: AbortSignal): Promise<PuckReply> {
    await this.connect();
    const client = this.client!;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]);
    const call = async (args: Record<string, unknown>) =>
      readPuckResult(
        await client.callTool({ name: 'puck', arguments: args }, undefined, {
          signal: bounded,
          timeout: 60_000,
          maxTotalTimeout: 60_000,
        }),
      );
    // A send can enqueue work. Retry only reads, always with this request's handle.
    let result = await call(puckArguments(this.tool!, message, this.conversationId));
    this.conversationId = result.conversationID;
    const handle = result.replyHandle;
    while (result.status === 'working' || result.status === 'queued') {
      if (!handle)
        throw new Error('Puck did not provide a reply handle. Check Amp before retrying.');
      await delay(this.pollInterval, undefined, { signal: bounded });
      const next = await call({ action: 'read_reply', params: { replyHandle: handle } });
      if (next.conversationID !== result.conversationID || next.replyHandle !== handle)
        throw new Error('Puck returned an unrelated reply.');
      result = next;
    }
    if (result.status !== 'replied' || !result.reply?.trim())
      throw new Error('Puck did not return a reply. Check its conversation before retrying.');
    return result;
  }
  async close() {
    const client = this.client;
    this.client = undefined;
    this.tool = undefined;
    this.conversationId = undefined;
    await client?.close().catch(() => {});
    this.auth.invalidateCredentials('all');
  }
}
