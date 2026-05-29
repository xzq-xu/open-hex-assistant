# Open Hex Assistant Roadmap

Language: [中文](ROADMAP.md) | English

This roadmap is the source of truth for future priorities. New features, refactors, and release plans should align with these goals, boundaries, and phases first. Work that does not fit the roadmap should be delayed or rejected by default.

## Product Positioning

Open Hex Assistant should be a free and open-source ARAM Mayhem assistant for Chinese-server-oriented play:

- China-region data first.
- Local-first by default, with no screenshot or match-state upload.
- Explainable recommendations instead of black-box answers.
- Low-latency in-game overlay.
- No license keys, device binding, paid tiers, or closed-source core.

## Development Principles

- **Structured data first**: use LCU, Live Client Data, and public statistics before OCR or AI guessing.
- **OCR only fills gaps**: use OCR for screen-only content without stable APIs, such as the three augment titles.
- **Local rules first**: the recommendation engine must remain useful without an external API key.
- **AI is optional enhancement**: external AI can only be an explicit user-enabled layer, never a core dependency.
- **Privacy by default**: do not upload screenshots, match state, summoner data, or device identifiers by default.
- **Explainable output**: every recommendation should expose a data basis, situational reason, or sample-risk note.
- **Avoid high-risk capabilities**: no memory reading, injection, automatic game clicks, license bypassing, or proprietary backend cloning.

## Release Path

### v0.2: Windows Usability Baseline

Goal: make the app usable for ordinary Windows users after unzip.

- Stabilize GitHub Release Windows zip artifacts.
- Bundle PaddleOCR ONNX model and dictionary.
- Improve first-run, missing-model, LCU-disconnected, and OCR-error messages.
- Lock down `F6/F7/F8/F9` hotkey behavior.
- Validate overlay visibility in fullscreen and borderless modes.
- Expand Windows usage docs and troubleshooting.

### v0.3: Recommendation Engine Upgrade

Goal: move from simple ranking to situational decisions.

- Add selected augment history.
- Feed item state, enemy threats, and allied composition into augment scoring.
- Add confidence and low-sample risk notes.
- Add conditional rules for major archetypes such as crit, ability haste, sustain, frontline, poke, and engage.
- Output a stable "recommended / fallback / avoid" explanation format.

### v0.4: Data Cache and Versioning

Goal: make recommendation data reproducible, offline-capable, and traceable.

- Cache public statistics, Data Dragon, and augment metadata locally.
- Record patch, update time, sample size, and data source.
- Show stale-data warnings and support manual refresh.
- Add patch diff for major champion, augment, and item movement.
- Provide offline mode using the last successful cache.

### v0.5: Complete Coach

Goal: make in-game Coach one of the core project capabilities.

- Analyze both rosters automatically during loading and game start.
- Maintain item, level, and threat state through Live Client Data during the match.
- Upgrade `F9` from manual-only to "hotkey plus state-change triggered" refresh.
- Support Compact and Expanded overlay modes.
- Standardize four output blocks: next item, biggest threat, teamfight plan, and augment direction.
- Add optional TAB-scoreboard OCR fallback while keeping structured data primary.

### v0.6: Optional AI Provider

Goal: add AI only after local rules are strong enough.

- Support user-provided OpenAI Compatible, Gemini, Ollama, and similar providers.
- Keep AI disabled by default.
- Send structured summaries only; do not upload full-screen screenshots by default.
- Require JSON AI output rendered by the local renderer.
- Show clear privacy prompts, sent-content preview, and disable controls.
- AI must not override deterministic local recommendations; it may only enrich explanation or strategy wording.

## Non-Goals

- No license keys or device binding.
- No mandatory online mode.
- No closed-source core recommendation logic.
- No automatic game actions.
- No memory reading, injection, or bypassing game protections.
- No default screenshot upload to third-party AI.
- No feature copying that sacrifices local usability or explainability.

## Near-Term Task Pool

- Split Coach rules into testable rule modules.
- Add selected augment history to augment recommendations.
- Add cache and stale markers to data loading.
- Add a Windows real-machine OCR / overlay validation checklist.
- Add more runtime scenarios to `runtime/overlay-state.example.json`.
- Add recommendation engine unit tests.

## Contribution Gate

Before accepting a feature, answer four questions:

1. Does it improve local usability, China-region data quality, recommendation quality, or transparency?
2. Does it protect user privacy by default?
3. Does it work without external AI or a license server?
4. Does it have a clear test or validation path?

If most answers are no, the feature should not enter the main line.
