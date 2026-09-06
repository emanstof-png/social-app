# CHANGELOG

One line per spec, newest first.

- **spec-12a** — Quality gates, pulled forward ahead of spec 03: GitHub Actions running lint, `tsc` and vitest on every push and PR with a README badge; a Playwright end-to-end login test (admin-minted magic link → the app's own `/auth/callback` → authenticated `/settings`) against a production build, skipping cleanly in CI until the Supabase repository secrets are added; husky + lint-staged pre-commit hook. Assessment/event-selection e2e tests and Lighthouse CI deferred until specs 03 and 07 exist.
- **spec-02** — LLM gateway (`lib/llm/gateway.ts`) as the single entry point for every model call, with Zod validation, one corrective retry and a `run_log` row per run; component registry with schemas and stub prompts; Settings page with encrypted provider keys, live per-component model dropdowns, run log with cost/latency and rerun-with-another-model; model setup as onboarding step 1, gating the assessment.
- **spec-01** — Next.js App Router scaffold with Tailwind and a PWA shell; Supabase magic-link auth gated in `proxy.ts`; all 15 tables from the data model with row-level security; Zod schemas and tests for every table; eight-section app shell.
- **spec-00** — Environment setup: Supabase project `wqawpwbgrsjusbdopgbi`, GitHub repo `emanstof-png/social-app`, Vercel project `gazelle`. Gemini added as a supported provider. No code.
