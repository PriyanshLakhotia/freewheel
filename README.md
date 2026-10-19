# Freewheel

Talk to Amp and Codex while your hands are occupied. Give either agent a task, hear a short result, and save the details for later.

Freewheel runs on your Mac: a small local companion controls your coding agents and serves the browser interface. It is not a hosted service. **No OpenAI API key is required for the default setup.**

![Freewheel session](docs/screenshots/freewheel.png)

## Start

Requires macOS, Node.js 22+, Chrome, an installed [Amp CLI](https://ampcode.com/docs), and access to Codex through your ChatGPT account. A compatible Codex CLI is pinned as a project dependency; your global installation is left alone.

```sh
git clone https://github.com/PriyanshLakhotia/freewheel.git
cd freewheel
npm ci
npx --no-install codex login  # only if this Mac is not already signed in
amp login                   # only if needed; an Amp token also works in the app
npm run build
npm start
```

Open **http://127.0.0.1:4318 in Chrome**. On later runs, double-click `Freewheel.command` or run `npm start`. Keep the Terminal process open. Control-C quits the companion and stops work that it is running.

1. In **Connections**, choose **Puck manager** and click **Sign in to Puck**. This connects the actual Puck in your Amp account through MCP. Keep the Amp CLI signed into the same account for automatic replies. Codex uses your existing ChatGPT login. **Direct Amp thread** remains available as a separate connection choice.
2. On **Session**, add the absolute folder path of your project and select it. New conversations run in that directory.
3. Connect your earphones. Choose their microphone and output in macOS Sound settings. Use **Test sound**.
4. Enable **Keep this Mac awake** if needed. Keep the lid open: this control does not defeat lid-close sleep.
5. Press **Start listening** and allow microphone access. First try the full interaction while stationary.

## Talk

> “Hey Codex.” → “Codex. Go ahead.” → “Investigate the failing checkout tests.” → task read-back → “Send it.”

Use **“Hey Puck”** for your Amp manager. Puck can start and steer several agents while you keep talking to it. With browser recognition you can also include a command in the same utterance as the wake phrase. With offline recognition or OpenAI transcription, pause after the wake phrase and wait for “go ahead.” Connecting an OpenAI key enables both voice output and command transcription; you can change either in Connections. Commands, follow-ups and confirmations then use OpenAI transcription. Wake detection and playback stop detection do not use the paid API.

| Say                             | Result                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- |
| “Hey Codex, status”             | Hear which agents are working or waiting.                                    |
| “Send it” / “Cancel”            | Send or discard the task just read back.                                     |
| “Say that again”                | Repeat the last spoken update.                                               |
| “Pause audio” / “Stop speaking” | Stop the current reply; the agent keeps working. Requires the local model.   |
| “Stop working”                  | Interrupt the addressed agent.                                               |
| “New task”                      | Begin a fresh conversation on that agent's channel.                          |
| “Approve three” / “Deny three”  | Answer that numbered Codex permission request.                               |
| “Quiet” / “Speak again”         | Hold or resume completion announcements. Requests for attention still speak. |

For 10 seconds after a reply, you can continue with the same agent without another wake phrase. The window is configurable. Finished replies wait while you dictate or confirm another task, then play one at a time. A spoken update selects its own conversation for follow-ups.

Puck manages its Amp threads; you can ask for another task without waiting for its agents to finish. Freewheel accepts concurrent Puck messages and tracks each queued reply by its own handle. New final replies in that Puck conversation are checked through the CLI every 10 seconds, without asking a model for status. The first request links the watcher to your Puck conversation; if the CLI account does not match, Connections reports that automatic replies are unavailable.

For Codex, “new task” opens a separate conversation while other conversations keep working. Follow-ups to an active conversation steer its running turn. “Stop working” addresses the selected conversation; Freewheel does not guess between several active tasks. Separate conversations still use the chosen local folder, so avoid concurrent edits to the same files. Direct Amp CLI mode permits one active task.

Agents are instructed to lead with a spoken briefing of at most 55 words. Playback is bounded, and full output remains in task details. **Stop listening** releases the microphone but lets agent tasks finish. **Stop task** cancels a task. During playback, a local recognizer listens only for **“pause audio”** or **“stop speaking”**. It stops the voice and clears queued announcements without cancelling agent work. Download the local model in Connections and start listening to enable it; it works with either listening engine and costs no API usage. The **Stop speaking** button also works.

The typed composer, conversation picker, task details, follow-ups, and permission cards work without starting a voice session. For existing Codex conversations, select their original project folder and finish any turn running in the desktop app first.

## Audio choices and cost

| Configuration                                           | Separate audio API charge | Tradeoff                                                                                                 |
| ------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Browser recognition + system voice (default)            | None from Freewheel       | Chrome's speech service may receive microphone audio. Network and browser lifecycle affect availability. |
| Vosk on this Mac + system voice                         | None                      | One-time ~40 MB model download. English only; technical dictation is less accurate.                      |
| Optional OpenAI command transcription and/or Nova voice | Usage based               | Connecting a key enables Nova voice and transcription. Either can be turned off independently.           |

Download the local model in Connections, then use **Test local recognition** to check wake phrases, stop phrases and ordinary speech without opening the microphone. The offline model remains outside the repository. Choosing offline listening keeps that recognition on your Mac; agents still need internet. If you enable cloud transcription, recorded commands go to OpenAI after the wake phrase. OpenAI transcription also handles spoken confirmations and follow-ups. Its vocabulary prompt includes agent and coding terms, but outdoor accuracy still needs testing with your microphone.

For paid audio, Freewheel uses `gpt-4o-mini-transcribe` at **$0.003 per recorded minute** and `tts-1` at **$15 per million spoken characters**. 9,000 spoken characters cost about **$0.14** for voice alone. Adding 15 minutes of dictated commands brings that to about **$0.18**. Twenty such hours would be about **$3.60**. Duration alone does not determine cost; idle listening is not sent to the paid OpenAI endpoint. Prices checked 19 October 2026; see [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

**Coding never uses the OpenAI audio key.** Codex requires ChatGPT sign-in and uses that subscription's limits; API-key coding is rejected. The companion strips OpenAI API credentials from both agent processes. Amp uses its account's plan, routing and credits; Freewheel does not turn either into unlimited usage. See [Codex app-server authentication](https://developers.openai.com/codex/app-server) and [Amp pricing](https://ampcode.com/docs/pricing). The optional audio API is separate from ChatGPT billing.

The app defaults to a $2 estimated audio budget per companion process. It reserves estimated spend before requests, including failed requests conservatively. This is an application-side guard, not a provider billing cap. Spend resets when the companion restarts.

## Integration boundaries

- **Puck manager connects to the real Puck through `https://ampcode.com/mcp`.** The first message uses your latest Puck conversation, then Freewheel keeps that manager for the session. Sign-in is session-only and currently requires port 4318. Puck manages its own projects, runners and orbs; the local project path is contextual, not an orb filesystem path. Direct Amp mode uses the coding CLI instead.
- **Stopping a Puck request stops waiting for its reply.** Puck and delegated agents may continue. Tell Puck which task to stop. Disconnecting Freewheel does not cancel remote work.
- **Codex runs through a local `codex app-server` process.** It can create and resume saved local conversations; it does not click or send messages through the Codex desktop UI. It cannot reliably arbitrate concurrent work started in another app, so do not run the same conversation in two places.
- Codex uses workspace-write sandboxing with on-request approvals. Numbered command/file requests can be answered by voice. Additional permission scopes and unsupported prompts are declined, with an explanation. Amp's noninteractive execution can block on permissions; review those tasks in Amp. No allow-all flag is enabled.
- A web tab cannot guarantee background operation through screen locking, tab suspension, closed-lid sleep, Bluetooth handovers, wind, or network outages. Reconnection and visible errors are implemented. Test your exact earphone and Mac setup before relying on it away from the desk. Keep the Mac ventilated and your surroundings audible.

## Local data

Puck OAuth tokens remain in memory and are cleared on disconnect or quit. Only Amp receives those tokens. The published OAuth client metadata contains no credentials.

The server binds only to `127.0.0.1`. Host and Origin checks, a same-site session cookie, and CSRF protection guard the local API. API keys entered in the UI stay in companion memory and are never written to local storage or task history. Keys and known token patterns are redacted from stored agent output. Existing agent authentication remains managed by its own CLI.

Projects, settings, and the last 200 task records are stored in `~/.local/share/freewheel/state.json` with restrictive permissions. They can contain code or other private task content. Clear local history in Connections; this does not delete Amp or Codex's own conversations. Audio recordings are transient; Freewheel does not write them to disk. Do not expose this local server through a public tunnel.

## Development and checks

```sh
npm run dev           # local companion + Vite
npm run check         # typecheck, isolated tests, production build
npm run format:check
```

GitHub Actions runs these checks on main and pull requests. Tests cover RPC lifecycle, task continuation/cancellation, approval scoping, voice confirmation, stale playback, API request security, credential redaction, and audio budget enforcement. They do not call paid APIs or access a microphone.

Explicit real-agent smoke tests require a running companion and consume account usage:

```sh
npm run smoke:amp
npm run smoke:codex
npm run smoke:amp -- --continue
npm run smoke:codex -- --continue
npm run smoke:concurrency
npm run smoke:puck
```

Useful environment variables: `PORT` (default 4318), `FREEWHEEL_DATA_DIR`, `FREEWHEEL_AMP_BIN`, and `FREEWHEEL_CODEX_BIN`. Existing `AMP_API_KEY` and `OPENAI_API_KEY` environment variables are recognized; the latter is used only by the audio service. The session-only UI fields avoid putting new secrets in shell history. Never commit credentials.

See [research and protocol decisions](docs/research.md), [verification record](docs/testing.md), and [product direction](docs/product.md).
