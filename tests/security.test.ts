import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { localSecurity } from '../server/security.js';

test('local API rejects foreign origins, DNS rebinding, CSRF and anonymous reads', async () => {
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as any).port;
  const { guard, session } = localSecurity(port);
  app.use(guard);
  app.use('/api', session);
  app.get('/api/bootstrap', (_req, res) => res.json({ csrf: res.locals.csrf }));
  app.get('/api/state', (_req, res) => res.json({ ok: true }));
  app.post('/api/mutate', (_req, res) => res.json({ ok: true }));
  const origin = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(origin + '/api/state')).status, 401);
    assert.equal(
      (await fetch(origin + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } }))
        .status,
      403,
    );
    const rebound = await new Promise<number | undefined>((resolve) => {
      const req = httpRequest(
        origin + '/api/bootstrap',
        { headers: { Host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    });
    assert.equal(rebound, 403);
    const bootstrap = await fetch(origin + '/api/bootstrap');
    const cookie = bootstrap.headers.get('set-cookie')!;
    assert(cookie.includes('HttpOnly'));
    assert(cookie.includes('SameSite=Strict'));
    const { csrf } = await bootstrap.json();
    const Cookie = cookie.split(';')[0];
    assert.equal((await fetch(origin + '/api/state', { headers: { Cookie } })).status, 200);
    assert.equal(
      (await fetch(origin + '/api/mutate', { method: 'POST', headers: { Cookie } })).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + '/api/mutate', {
          method: 'POST',
          headers: { Cookie, 'X-Freewheel-CSRF': 'é'.repeat(64) },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + '/api/mutate', {
          method: 'POST',
          headers: { Cookie, 'X-Freewheel-CSRF': csrf, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + '/api/mutate', {
          method: 'POST',
          headers: { Cookie, 'X-Freewheel-CSRF': csrf, Origin: origin },
        })
      ).status,
      200,
    );
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
