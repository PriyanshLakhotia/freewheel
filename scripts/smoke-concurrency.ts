/** Real Codex subscription usage. No tools or file edits requested. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.FREEWHEEL_URL || 'http://127.0.0.1:4318';
const response = await fetch(`${origin}/api/bootstrap`);
const { csrf, state } = await response.json();
const headers = {
  'Content-Type': 'application/json',
  Cookie: response.headers.get('set-cookie')!.split(';')[0],
  'X-Freewheel-CSRF': csrf,
};
async function send(prompt: string, continueTaskId?: string) {
  const response = await fetch(`${origin}/api/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent: 'codex',
      projectId: state.projects[0].id,
      prompt,
      continueTaskId,
    }),
  });
  const task = await response.json();
  if (!response.ok) throw new Error(task.error);
  return task;
}
const first = await send(
  'Freewheel parallel voice test A. Do not call tools or access files. Explain in about eighty words how a bicycle freewheel works.',
);
const second = await send(
  'Freewheel parallel voice test B. Do not call tools or access files. Answer exactly: Parallel task B completed.',
);
assert.notEqual(first.externalId, second.externalId);
const followup = await send(
  'Also include the exact phrase steering received in your final reply.',
  first.id,
);
assert.equal(followup.id, first.id, 'input should steer the active turn');
for (let i = 0; i < 90; i++) {
  const { state: current } = await (await fetch(`${origin}/api/bootstrap`, { headers })).json();
  const tasks = [first, second].map((t) => current.tasks.find((x: any) => x.id === t.id));
  if (tasks.every((t) => ['completed', 'error', 'stopped'].includes(t.status))) {
    assert(tasks.every((t) => t.status === 'completed'));
    assert.match(tasks[0].output, /steering received/i);
    assert.match(tasks[1].output, /Parallel task B completed/i);
    console.log(
      JSON.stringify({
        parallelConversations: true,
        activeTurnSteering: true,
        results: tasks.map((t) => t.status),
      }),
    );
    process.exit(0);
  }
  await delay(1000);
}
throw new Error('Still running after 90 seconds; inspect Freewheel.');
