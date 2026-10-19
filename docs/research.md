# Integration research

Verified 19 October 2026. Pricing and preview APIs can change.

- Codex app-server provides JSON-RPC thread lifecycle, streamed turns, authentication and approvals. ChatGPT login is supported; a separate API key is not necessary for coding. Use local stdio, not an unauthenticated network listener. https://developers.openai.com/codex/app-server
- The installed Codex CLI is 0.145.0 and already uses ChatGPT login. Protocol schemas must be checked against the installed binary.
- Amp supports execute mode, streaming JSON, existing CLI authentication and AMP_API_KEY. Its SDK exposes continuation, cancellation and local/remote executors. https://ampcode.com/docs/sdk/typescript
- Puck is Amp’s personal management assistant. Do not imply the generic Amp SDK is the actual Puck API. Public API support is being checked. https://ampcode.com/docs/puck
- Amp usage follows the user’s plan, model routing and credits, and remote orbs have separate resource usage. https://ampcode.com/docs/pricing
- Browser SpeechRecognition is not universally supported and can send audio to the browser provider. It is not a guaranteed local wake-word detector. https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- Browser screen wake lock is visibility-dependent. A local macOS caffeinate process is the appropriate companion control. It does not guarantee operation with the laptop lid closed. https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- Optional OpenAI speech is separately billed. Mini transcription is approximately $0.003 per minute of recorded input. Current Realtime mini audio rates are $10 per million input audio tokens and $20 per million output audio tokens; token rates are not per-minute prices. https://developers.openai.com/api/docs/pricing

Design reference: Anthropic frontend-design skill, read directly from its maintained source. https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
