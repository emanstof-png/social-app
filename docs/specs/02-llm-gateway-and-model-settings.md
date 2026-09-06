# Spec 02 — LLM gateway and model settings (PRD §5)

## Scope
1. `lib/llm/gateway.ts`: single entry `runComponent(component, input)`. Resolves provider/model from `model_settings`; loads key from `provider_keys` (decrypt with ENCRYPTION_KEY); calls provider via OpenAI-compatible chat API (Anthropic via its SDK, OpenRouter, Groq, local base_url); supports tool-calling; validates output with the component's Zod output schema; one retry on invalid; logs every call to `run_log` (model, tokens, cost estimate, latency).
2. Component registry: `lib/llm/components/` with one file per component (interview, persona_synthesis, activity_suggestion, discovery_research, event_extraction, weekly_planning, invite_suggestion). For this spec each has schemas + a stub system prompt; real prompts arrive in later specs.
3. Settings page: (a) provider keys form (Anthropic, OpenRouter, Groq, local URL) stored encrypted; (b) per-component dropdown of provider+model, with a "supports tools" badge; discovery_research only lists tool-capable models; (c) run log table with filters; (d) "Rerun with model X" action that re-executes a logged run with a chosen model and shows both outputs side by side.
4. Onboarding step 1 = this settings page (must complete before assessment).
5. Tests: gateway validation/retry/logging with a mocked provider.

## Acceptance criteria
- Changing a dropdown changes which model the next call uses (verified in run_log).
- A deliberately invalid model output triggers one retry then a logged error.
- Rerun shows two outputs side by side for the same input.

## Out of scope
Real component prompts, any UI beyond Settings.
