import type { Agent } from './types.js';

// Codex is outside the small Vosk model's vocabulary; its phonetic spelling is in it.
// The unknown token lets background speech be rejected instead of forced into a wake phrase.
export const WAKE_GRAMMAR = JSON.stringify(['hey puck', 'hey code x', 'hey codecs', '[unk]']);
export const INTERRUPT_PHRASES = ['pause audio', 'stop speaking'] as const;
export const INTERRUPT_GRAMMAR = JSON.stringify([...INTERRUPT_PHRASES, '[unk]']);

const normalizeSpeech = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function interruptionPhrase(text: string, playback: string): string | undefined {
  // Unknown words inside a phrase must not be joined into a command.
  const heard = normalizeSpeech(text)
    .replace(/^(?:\[unk\]\s*)+|(?:\s*\[unk\])+$/g, '')
    .trim();
  const output = normalizeSpeech(playback);
  return INTERRUPT_PHRASES.find((phrase) => heard === phrase && !output.includes(phrase));
}

export function availableInterruptionPhrase(playback: string): string | undefined {
  const output = normalizeSpeech(playback);
  return INTERRUPT_PHRASES.find((phrase) => !output.includes(phrase));
}

export function speechText(input: string, maxWords = 65): string {
  const plain = input
    .replace(/```[\s\S]*?```/g, ' Code is in the transcript. ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the linked page')
    .replace(/(?:^|\n)\s*[#>*-]+\s*/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain.split(/\s+/);
  if (words.length <= maxWords) return plain;
  const excerpt = words.slice(0, maxWords - 7).join(' ');
  const lastSentence = excerpt.search(/[.!?][^.!?]*$/);
  return (
    (lastSentence > excerpt.length / 2 ? excerpt.slice(0, lastSentence + 1) : `${excerpt}.`) +
    ' More detail is in the transcript.'
  );
}
export function detectWake(text: string): { agent: Agent; command: string } | null {
  const match = text
    .trim()
    .match(/^(?:hey|hi|okay|ok)[,\s]+(puck|codex|codecs|code x)[,\s.!?:;-]*(.*)$/i);
  if (!match) return null;
  return { agent: match[1].toLowerCase() === 'puck' ? 'amp' : 'codex', command: match[2].trim() };
}
export type VoiceIntent =
  | { type: 'status' | 'repeat' | 'stop' | 'quiet' | 'unquiet' | 'cancel' | 'send' | 'new' }
  | { type: 'approve' | 'deny'; number: number }
  | { type: 'task'; text: string };
export function parseIntent(text: string): VoiceIntent {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?]/g, '')
    .trim();
  const known: Record<string, VoiceIntent['type']> = {
    status: 'status',
    'what is happening': 'status',
    "what's happening": 'status',
    'any updates': 'status',
    repeat: 'repeat',
    'say that again': 'repeat',
    stop: 'stop',
    'stop working': 'stop',
    quiet: 'quiet',
    'quiet mode': 'quiet',
    mute: 'quiet',
    'speak again': 'unquiet',
    unmute: 'unquiet',
    cancel: 'cancel',
    'never mind': 'cancel',
    nevermind: 'cancel',
    'send it': 'send',
    'new task': 'new',
    'start a new task': 'new',
  };
  const numbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const approval = normalized.match(
    /^(approve|deny) (?:request )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/,
  );
  if (approval)
    return {
      type: approval[1] as 'approve' | 'deny',
      number: numbers[approval[2]] ?? Number(approval[2]),
    };
  if (known[normalized]) return { type: known[normalized] } as VoiceIntent;
  return { type: 'task', text: text.trim() };
}
export const SPOKEN_INSTRUCTIONS = `You are being used through Freewheel, a hands-free audio interface. The user may not see a screen. Work normally, but keep progress quiet unless you need input. In your FINAL response, lead with a plain-English spoken briefing of at most 55 words: outcome, meaningful caveat or verification, and any next decision. No markdown, code, URLs, paths, or long enumerations in that opening. Put optional technical detail after a line containing exactly ---DETAILS---. Do not claim completion without verification. Ask one short question at a time. Follow the user's task and repository instructions. This audio format does not grant additional permissions.`;
export function extractBriefing(text: string): string {
  return speechText(text.split('---DETAILS---')[0]);
}
