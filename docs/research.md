# Integration research

Verified 19 October 2026. Pricing, agent capabilities, and preview APIs can change.

## Codex

Freewheel uses a child `codex app-server` process with JSON-RPC over stdio. It reads account state, starts or resumes threads, starts and interrupts turns, consumes streamed events, and answers supported approval requests. The existing ChatGPT login works; a separate API key is unnecessary for coding. [App-server documentation](https://developers.openai.com/codex/app-server)

The global CLI on this Mac was 0.145.0. A real task failed because the account's configured model required a newer client. Freewheel now pins `@openai/codex@0.163.0` locally. Real new-turn and continuation tests then passed, without modifying the global CLI or the user's model configuration.

Freewheel opens its own app-server process. It does not automate the desktop UI. Thread status is not a reliable distributed lock across every application using the same history, so the UI asks users to finish desktop turns before resuming. It verifies the original project directory and rejects active turns visible to its server.

The requested policy is workspace-write, on-request, with approvalsReviewer set to user. Command and file approvals are scoped to a live request and task; generic “yes” cannot approve. Additional permission scopes are declined and unsupported RPC requests fail explicitly. Repository instructions and configured agent tools still apply.

## Amp and the Puck name

Amp supports execute mode, streaming JSON, private new threads, and continuation. Authentication uses the CLI login or AMP_API_KEY. Freewheel sends prompts over stdin without a shell, parses stream messages, and cancels the owned process group. [Execute mode](https://ampcode.com/docs/cli/execute-mode), [streaming JSON](https://ampcode.com/docs/cli/execute-mode/streaming-json), [TypeScript SDK](https://ampcode.com/docs/sdk/typescript)

Amp's built-in Puck is a different product surface. The documented external API concerns data and directs product automation to the CLI and SDK. No documented Puck conversation endpoint was found. “Hey Puck” is therefore a wake alias for an Amp coding agent in Freewheel. It does not manage Puck, remote orbs, or remote agent fleets. [Puck](https://ampcode.com/docs/puck), [external API](https://ampcode.com/api/external)

New tasks use medium mode and private visibility; continuations preserve the existing thread. No allow-all flag is enabled. Permission denials become actionable errors because noninteractive execution cannot expose the full interactive permission flow. Coding cost follows the account's plan, routing and credits. Orb resource usage is separate and not implemented here. [Amp pricing](https://ampcode.com/docs/pricing)

## Audio and wake phrases

Browser SpeechRecognition needs no application API key, but support is limited and its service can receive audio while listening. It must not be described as a private hardware wake-word detector. Chrome is the supported first target. [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

The local alternative is vosk-browser with vosk-model-small-en-us-0.15. WASM runs in a browser worker; a fixed official model URL is downloaded through the companion and stored outside Git. Its official listing specifies Apache 2.0 licensing. [Vosk models](https://alphacephei.com/vosk/models)

Unconstrained recognition misheard synthetic “Hey Codex” as “Kodak's.” The idle recognizer now uses “hey puck,” phonetic Codex variants, and an unknown-word token. A wake switches to command dictation after acknowledgement. Both wake samples pass in Chrome and ordinary speech is rejected. This does not establish performance for accents, outdoor noise, or continuous background speech.

Recognition pauses during playback to avoid feedback. This is turn-taking audio without voice interruption during playback. Task read-back requires “send it”; permission requests require a number. Spoken output is bounded and technical details stay in the transcript.

## Optional OpenAI audio

Idle listening is not sent to OpenAI. After a wake and acknowledgement, optional recording ends on silence (maximum 45 seconds) and goes to the transcription endpoint using gpt-4o-mini-transcribe. Optional output uses the speech endpoint, tts-1, and Nova. System voice is the fallback. [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text), [text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)

| Service            | Published rate used in the app |
| ------------------ | ------------------------------ |
| Mini transcription | $0.003 per recorded minute     |
| TTS-1              | $15 per million characters     |

15 dictated minutes plus 9,000 spoken characters: `15 × 0.003 + 9000 / 1000000 × 15 = $0.18`. Coding is separate. The in-app budget is a conservative estimate per companion process, not a provider billing limit. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

Realtime could provide more fluid interruption and turn-taking, but adds continuous audio infrastructure and separate billing. This version uses short explicit exchanges and does not call a Realtime endpoint. Paid endpoints were contract-tested with mocked fetch, not a live key.

## Sleep and execution

Browser Wake Lock depends on visibility. Freewheel instead owns a reversible macOS `caffeinate -di -w <companion-pid>` process that stops when toggled off or the companion exits. It does not override lid-close sleep. [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)

A hosted static app cannot own these local processes. The React interface and Express companion share a loopback-only origin guarded by Host/Origin checks, session cookies and CSRF tokens. UI credentials remain in process memory. This assumes a trusted local machine and is not a multiuser remote service.

## Design

IBM Plex Sans, a paper/ink palette, restrained blue and amber channel markers, and a radial microphone instrument. Controls show real connection, task and microphone state. Layout inspected in Chrome and at a narrow mobile width.

Design reference: Anthropic's [frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), read from its maintained source. See [product direction](product.md).
