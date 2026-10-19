/** Real Amp account usage. Requires Sign in to Puck; requests no agents, tools or file changes. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.FREEWHEEL_URL || 'http://127.0.0.1:4318';
const response = await fetch(`${origin}/api/bootstrap`);
const { csrf, state } = await response.json();
assert(
  state.settings.ampMode === 'puck' && state.connections.amp.connected,
  'Sign in to Puck first.',
);
const headers = {
  'Content-Type': 'application/json',
  Cookie: response.headers.get('set-cookie')!.split(';')[0],
  'X-Freewheel-CSRF': csrf,
};
const stamp = Date.now();
const ids = await Promise.all(
  ['A', 'B'].map(async (label) => {
    const result = await fetch(`${origin}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent: 'amp',
        projectId: state.projects[0].id,
        prompt: `Freewheel concurrent message ${label}, test ${stamp}. Do not call tools, start agents, access files, or make changes. Reply exactly: Puck received message ${label}.`,
      }),
    });
    assert(result.ok, 'Puck dispatch failed');
    return (await result.json()).id as string;
  }),
);
for (let i = 0; i < 90; i++) {
  const { state: current } = await (await fetch(`${origin}/api/bootstrap`, { headers })).json();
  const tasks = ids.map((id) => current.tasks.find((task: any) => task.id === id));
  if (tasks.every((task) => ['completed', 'error', 'stopped'].includes(task.status))) {
    assert(
      tasks.every((task) => task.status === 'completed'),
      'Inspect Puck task errors',
    );
    assert.equal(tasks[0].output, 'Puck received message A.');
    assert.equal(tasks[1].output, 'Puck received message B.');
    assert.equal(tasks[0].externalId, tasks[1].externalId);
    assert.equal(current.puckUpdates, 'watching');
    console.log(
      JSON.stringify({
        concurrentPuckMessages: true,
        repliesMatched: true,
        automaticUpdates: current.puckUpdates,
      }),
    );
    process.exit(0);
  }
  await delay(1000);
}
throw new Error('Puck is still working after 90 seconds; inspect Freewheel.');
