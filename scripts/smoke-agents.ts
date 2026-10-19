/** Real, metered smoke test. Explicit opt-in; never run as part of npm test or CI. */
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.FREEWHEEL_URL || 'http://127.0.0.1:4318';
const response = await fetch(`${origin}/api/bootstrap`);
const cookie = response.headers.get('set-cookie')!.split(';')[0];
const { csrf, state } = await response.json();
const headers = { 'Content-Type': 'application/json', Cookie: cookie, 'X-Freewheel-CSRF': csrf };
const agent = process.argv[2];
if (!['amp', 'codex'].includes(agent))
  throw new Error('Pass amp or codex. This starts one real agent turn.');
const created = await fetch(`${origin}/api/tasks`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    agent,
    projectId: state.projects[0].id,
    prompt:
      'Freewheel connection test. Do not run tools, inspect files, or make changes. Reply with exactly: Voice connection confirmed. Seventeen times three is fifty-one.',
  }),
});
const task = await created.json();
if (!created.ok) throw new Error(task.error);
console.log(`${agent}: task started`);
for (let i = 0; i < 60; i++) {
  await delay(1000);
  const { state } = await (await fetch(`${origin}/api/bootstrap`, { headers })).json();
  const current = state.tasks.find((t: any) => t.id === task.id);
  if (current && ['completed', 'error', 'stopped'].includes(current.status)) {
    console.log(
      JSON.stringify({
        agent,
        status: current.status,
        summary: current.summary,
        error: current.error,
        externalIdPresent: !!current.externalId,
      }),
    );
    if (current.status !== 'completed') process.exitCode = 1;
    break;
  }
  if (i === 59) {
    console.log('Still running after 60 seconds; inspect the task.');
    process.exitCode = 1;
  }
}
