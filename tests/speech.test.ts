import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWake, parseIntent, speechText, extractBriefing } from '../shared/speech.js';

test('ambient mentions never activate an agent', () => {
  for (const text of [
    'I saw Puck yesterday',
    'The phrase hey codex is useful',
    'yes',
    'approve one',
    'send it',
    'Codex, fix this',
  ])
    assert.equal(detectWake(text), null);
});
test('explicit wake phrases route to the correct channel', () => {
  assert.deepEqual(detectWake('Hey Puck, fix the tests.'), {
    agent: 'amp',
    command: 'fix the tests.',
  });
  assert.deepEqual(detectWake('Hey Codex!'), { agent: 'codex', command: '' });
  assert.deepEqual(detectWake('hey code x, status'), { agent: 'codex', command: 'status' });
});
test('approval syntax is exact and scoped by number', () => {
  assert.deepEqual(parseIntent('Approve three.'), { type: 'approve', number: 3 });
  assert.deepEqual(parseIntent('deny request 12'), { type: 'deny', number: 12 });
  for (const text of ['yes', 'approve everything', 'approved three', 'approve three and run tests'])
    assert.equal(parseIntent(text).type, 'task');
});
test('normal task text is not mistaken for a local command', () => {
  assert.equal(parseIntent('stop the animation on hover').type, 'task');
  assert.equal(parseIntent('status').type, 'status');
  assert.equal(parseIntent('send it').type, 'send');
});
test('briefings remove unhelpful visual syntax and are bounded', () => {
  const source =
    '## Done\nFixed the [checkout](https://example.com) bug.\n```js\nconsole.log(1)\n```\n' +
    'Additional detail. '.repeat(100);
  const result = speechText(source);
  assert(!result.includes('https'));
  assert(!result.includes('console.log'));
  assert(result.split(/\s+/).length <= 65);
  assert(result.includes('transcript'));
  assert.equal(
    extractBriefing('Fixed the bug.\n---DETAILS---\nHuge technical explanation.'),
    'Fixed the bug.',
  );
});
