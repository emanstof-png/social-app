# Spec 06 addendum — model fallback for unattended jobs

## Decisions (settled, 2026-09-06)
- OpenRouter free models return 429 unpredictably from the shared upstream pool while the key remains valid. Acceptable interactively, not for unattended scheduled jobs.
- No OpenRouter credit will be purchased. Instead, add a model-provider fallback chain in the gateway: Gemini primary (most reliable free option in live tests) → OpenRouter free model → Ollama Cloud free tier. On 429/quota, fall through automatically and log each attempt in run_log.
- Ollama Cloud: add as a third provider. OpenAI-compatible endpoint, base-URL swap. Free tier is 1 concurrent request on starter models, no SLA, so it is a last-resort fallback, not a primary.
- Local Ollama remains rejected for production (Vercel cannot reach a home machine without a paid tunnel). Fine for local dev.

Applies to every scheduled job in specs 06, 09, and 11.
