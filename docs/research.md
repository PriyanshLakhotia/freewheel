# Integration research

Verified 19 October 2026. Pricing, agent capabilities, and preview APIs can change.

## Codex

Freewheel uses a child `codex app-server` process with JSON-RPC over stdio. It reads account state, starts or resumes threads, starts and interrupts turns, consumes streamed events, and answers supported approval requests. The existing ChatGPT login is required. The process starts with `forced_login_method="chatgpt"` and the OpenAI provider; account type is checked again before every task. API-key authentication is rejected, and OpenAI API environment variables are removed from both coding processes. [App-server documentation](https://developers.openai.com/codex/app-server)

The global CLI on this Mac was 0.145.0. A real task failed because the account's configured model required a newer client. Freewheel now pins `@openai/codex@0.163.0` locally. Real new-turn and continuation tests then passed, without modifying the global CLI or the user's model configuration.

Freewheel opens its own app-server process. It does not automate the desktop UI. Thread status is not a reliable distributed lock across every application using the same history, so the UI asks users to finish desktop turns before resuming. It verifies the original project directory and rejects externally active turns when resuming. Within Freewheel, separate Codex threads can run concurrently; additional input for its own active turn uses `turn/steer` with `expectedTurnId`. Approvals stay scoped to their original task.

The requested policy is workspace-write, on-request, with approvalsReviewer set to user. Command and file approvals are scoped to a live request and task; generic “yes” cannot approve. Additional permission scopes are declined and unsupported RPC requests fail explicitly. Repository instructions and configured agent tools still apply.

## Puck and direct Amp

Correction to the initial research: the documented Puck MCP integration was missed. Amp announced it on 13 October 2026. `https://ampcode.com/mcp` exposes `puck` and `orbs`; the `puck` tool sends messages to the user's latest Puck conversation. Puck can delegate, steer and monitor multiple agents. [Puck integration](https://ampcode.com/docs/puck#use-puck-in-other-apps), [announcement](https://ampcode.com/news/take-puck-with-you)

Freewheel uses the official MCP SDK, discovers the live tool schema, and calls only `puck`. Amp advertises CIMD client registration and PKCE S256. Freewheel publishes non-secret client metadata in this repository, validates one-use OAuth state, restricts network destinations to Amp, and holds tokens only in memory. The supported callback is `http://127.0.0.1:4318/puck/callback`. Actual sign-in and an authenticated live Puck request still need verification with the user's authorization.

The MCP request returns its immediate reply. Later Puck replies are observed through the Amp CLI: search for a unique request marker, verify the exported thread is Puck, then read new completed assistant messages. Historical, partial and tool messages are excluded; stable message IDs prevent replay. Polling every 10 seconds makes no model call. This requires CLI authentication to the same Amp account and is reported separately from the MCP connection. The export structure was inspected on a real Puck thread; delivery is tested using fixtures until live sign-in is complete.

Direct Amp coding remains a separate selectable mode using execute/continuation with streaming JSON. No allow-all flag is enabled. Its local process receives no OpenAI API credentials. Coding follows the account's plan and model routing; orb resources may have additional costs. [Execute mode](https://ampcode.com/docs/cli/execute-mode), [streaming JSON](https://ampcode.com/docs/cli/streaming-json), [Amp pricing](https://ampcode.com/docs/pricing)

## Audio and wake phrases

Browser SpeechRecognition needs no application API key, but support is limited and its service can receive audio while listening. It must not be described as a private hardware wake-word detector. Chrome is the supported first target. [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

The local alternative is vosk-browser with vosk-model-small-en-us-0.15. WASM runs in a browser worker; a fixed official model URL is downloaded through the companion and stored outside Git. Its official listing specifies Apache 2.0 licensing. [Vosk models](https://alphacephei.com/vosk/models)

Unconstrained recognition misheard synthetic “Hey Codex” as “Kodak's.” The idle recognizer now uses “hey puck,” phonetic Codex variants, and an unknown-word token. A wake switches to command dictation after acknowledgement. Both wake samples pass in Chrome and ordinary speech is rejected. This does not establish performance for accents, outdoor noise, or continuous background speech.

During playback, ordinary command recognition pauses. A separate local grammar accepts only “pause audio” or “stop speaking”; it can stop voice playback but cannot start tasks or answer approvals. Partial results allow early interruption. Stopping also cancels pending browser audio fetches and clears queued announcements, while agent work continues. The model is loaded at voice-session start when installed, even with browser listening selected.

Echo cancellation is requested from the browser, not guaranteed. A stop phrase present in the spoken text is ignored for that reply so the app does not obey its own words; the alternative phrase remains available unless both appear. After playback stops, a short delay discards residual audio before normal commands resume. Synthetic stop-phrase and ordinary-reply samples pass in Chrome. This does not establish performance with the actual earphones or wind. [Echo cancellation constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation)

Task read-back requires “send it”; permission requests require a number. Spoken output is bounded and technical details stay in the transcript.

## Optional OpenAI audio

The OpenAI key is used only by the two audio endpoints. Connecting it enables text-to-speech and command transcription. Either remains independently selectable. Wake detection never supplies task text in API mode; recorded commands, confirmations and follow-ups go through transcription. No Responses, Chat Completions, agent or Realtime API is used by Freewheel. Idle listening and playback stop detection are not sent to the paid OpenAI API. After a wake and acknowledgement, optional recording ends on silence (maximum 45 seconds) and goes to the transcription endpoint using gpt-4o-mini-transcribe. Optional output uses the speech endpoint, tts-1, and Nova. System voice is the fallback. The transcription prompt supplies agent names and coding vocabulary, a documented technique for improving recognition of specific words; this is a reason to try it for technical dictation, not proof of better performance on a bike. [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text), [text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)

| Service            | Published rate used in the app |
| ------------------ | ------------------------------ |
| Mini transcription | $0.003 per recorded minute     |
| TTS-1              | $15 per million characters     |

15 dictated minutes plus 9,000 spoken characters: `15 × 0.003 + 9000 / 1000000 × 15 = $0.18`. Coding is separate. The in-app budget is a conservative estimate per companion process, not a provider billing limit. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

Local stop detection avoids a continuously billed Realtime connection. Paid speech and transcription endpoints were contract-tested with mocked fetch, not a live key.

## Sleep and execution

Browser Wake Lock depends on visibility. Freewheel instead owns a reversible macOS `caffeinate -di -w <companion-pid>` process that stops when toggled off or the companion exits. It does not override lid-close sleep. [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)

A hosted static app cannot own these local processes. The React interface and Express companion share a loopback-only origin guarded by Host/Origin checks, session cookies and CSRF tokens. UI credentials remain in process memory. This assumes a trusted local machine and is not a multiuser remote service.

## Design

IBM Plex Sans, a paper/ink palette, restrained blue and amber channel markers, and a radial microphone instrument. Controls show real connection, task and microphone state. Layout inspected in Chrome and at a narrow mobile width.

Design reference: Anthropic's [frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), read from its maintained source. See [product direction](product.md).
