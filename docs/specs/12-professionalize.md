# Spec 12 — Professionalize (post-build)
Run after spec 11. Goal: make gazelle something you'd show an engineer or employer, and something you can measure. No new product features. Split into 12a–12d so each is one session.

## 12a — Quality gates
1. GitHub Actions workflow: on every push and PR run `lint`, `tsc`, and tests. Fail the build on any failure. Add status badge to README.
2. Playwright end-to-end tests for the three core flows: login, complete assessment, select an event. Run in CI.
3. Lighthouse CI on the deployed preview: performance, accessibility, PWA checks. Report in PR.
4. Pre-commit hook (husky + lint-staged) so bad code never gets committed.

## 12b — Observability and safety
1. Sentry (free tier): error capture on client and server, source maps uploaded on deploy.
2. Structured logging for scheduled jobs; failures surface in the app UI (already required by CLAUDE.md) and in Sentry.
3. Rate limiting on API routes and LLM gateway calls per user.
4. Key rotation: regenerate Supabase secret, OpenRouter, and Gemini keys (they were pasted into chats during setup); update `.env.local` and Vercel. — DONE 2026-09-06: all three keys regenerated, .env.local and Vercel updated, Supabase verified live under auth; OpenRouter and Gemini pending real exercise in spec 02. Old keys not yet deleted.
5. `/admin` page (user-gated): run_log with cost/latency, scheduled job history, scraper health per community.

## 12c — Product analytics
1. PostHog (free tier): page views, identify user, and events for: assessment_started, assessment_completed, community_added, event_selected, evaluation_submitted, contact_added, invite_sent.
2. Funnels: assessment start → complete; feed view → event selected → attended → evaluated.
3. Session replay on (single user for now; mask any contact PII).
4. Feature flags available for later experiments.

## 12d — Presentation
1. README rewrite: what it is, screenshots (mobile + desktop), architecture diagram (Mermaid), how the model routing works, how to run locally, how it was built (spec-driven, review-gated agent workflow).
2. `docs/ADR.md`: architecture decision records, one short entry each: BYOK model keys, Gemini for research, stateless/spec-driven build process, Supabase over custom backend, PWA over native, never-delete/archive rule.
3. Demo mode or 60-second screen recording.
4. Staging environment: second Vercel project + second Supabase project on a `staging` branch, so testing never touches real data.

## 12e — Sign-in and brand
1. Google sign-in via Supabase Auth: create OAuth client in Google Cloud (same project as Calendar API), add client ID/secret to Supabase → Authentication → Providers → Google, add Google button to the login page alongside magic link.
2. Apple sign-in: deferred until App Store or user demand (requires Apple Developer account, $99/yr). Document the steps; do not build yet.
3. Brand assets in `public/brand/`: hero illustration (lone gazelle looking toward a herd, 90s Nickelodeon/Disney cel style), square icon crop for PWA (single gazelle head), wide tagline version. Tagline: "Find your herd." Apply to login page, PWA splash, and README.
4. Note: Vercel Deployment Protection stays OFF for production permanently; the app's own auth is the protection. Protection may be used on preview deployments only.

## Device testing (no spec needed, just practice)
- Chrome DevTools device mode for layout (free, instant).
- Xcode iOS Simulator for PWA install and push behavior on Safari.
- Vercel preview URLs: open any branch on your real phone before merging.
- BrowserStack only if real-hardware bugs appear.

## Acceptance
- CI green on main; badge in README.
- Sentry receiving events from prod.
- PostHog showing the assessment funnel with real data.
- README + ADR readable by a non-team engineer in under 10 minutes.
