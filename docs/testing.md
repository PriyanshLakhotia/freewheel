# Verification record

19 October 2026, macOS, Chrome, Node 24. These checks establish specific paths, not outdoor or all-device reliability.

## Automated

`npm run check` passes TypeScript checks, 10 isolated tests and the production build. Formatting is enforced in CI. Tests cover:

- Concurrent JSON-RPC response matching, notifications, disconnects and transport restart.
- Approval scoping, stale replies, continuation, one active turn per agent, cancellation, secret redaction and shutdown persistence.
- Local API Host/Origin checks, DNS-rebinding attempts, cookies, CSRF and Unicode headers.
- Wake routing, ignored ambient mentions, numbered approval syntax, bounded briefings, task confirmation and matching approvals to their agent.
- Explicit wakes opening dictation with automatic follow-ups disabled; stale playback completions cannot reopen listening after stopping output.
- Audio key requirements, reserving estimated budget before requests, and fixed OpenAI destinations. Network calls are mocked.

CI needs no microphone, credentials, real agents or paid endpoints. Vosk's lazy WASM chunk is large; Vite reports its expected size warning. It loads only for offline recognition or diagnostics.

## Real integration checks

| Check                                  | Observed result                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Amp and Codex authentication           | Connected using existing CLI and ChatGPT logins.                                                             |
| Amp new conversation                   | Correct arithmetic reply, completed state and saved thread ID.                                               |
| Codex new conversation                 | Correct reply after pinning the project-local CLI to 0.163.0.                                                |
| Amp continuation                       | Recalled 51 and returned 52.                                                                                 |
| Codex follow-up through UI             | Task details → Follow up → Send task; recalled 51 and returned 52.                                           |
| Offline wake phrases in Chrome         | Both “hey codecs [unk]” and “hey puck [unk]” routed correctly.                                               |
| Ordinary speech through offline engine | “[unk] hey [unk] code [unk]” activated neither channel.                                                      |
| Keep-awake UI                          | Started the owned caffeinate process; turning it off removed it.                                             |
| Production interface                   | Session, connections, task details, follow-up composer, diagnostics and responsive layout inspected.         |
| Companion restart                      | Disconnected banner appeared; restarting the process restored the UI automatically with a fresh API session. |
| Saved conversation pickers             | Loaded 30 Codex conversations and 8 Amp conversations. Unrelated threads were not modified.                  |

The audio diagnostics use synthetic Samantha-voice WAVs, not user recordings. The initial failed Codex task remains in local history as a record of the old-client error. New tasks and continuations succeeded after the fix.

## Still requires the user's setup

- Actual earphone input/output, microphone permissions, accent, wind, street noise, long sessions, Bluetooth reconnects, screen locking and tab suspension.
- Real OpenAI transcription and Nova playback: no key was supplied. Budget and API behavior have isolated tests only.
- Real consequential approval flows: tests use deterministic protocol fixtures. Agent smoke tests requested no tools or file changes.
- Simultaneous editing or resuming a conversation still active in another app. The UI tells users to avoid these conflicts.

Before a ride, choose the real project and test sound. While stationary, try each wake phrase, dictate a harmless task, check its read-back and say “cancel.” Then send a task with “send it.” Check “status,” “say that again” and “stop working.” Keep the Mac open and ventilated. End listening before changing input devices.
