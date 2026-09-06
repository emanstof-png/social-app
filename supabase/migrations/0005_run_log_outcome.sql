-- gazelle spec 02 — record the outcome of a gateway run, not just its cost
--
-- Spec 01 created run_log with component/model/tokens/cost/latency only, which
-- can describe a successful call but not a failed one. Spec 02's acceptance
-- criteria need both:
--   "A deliberately invalid model output triggers one retry then a logged error"
--   "Rerun shows two outputs side by side for the same input"
-- The first needs a status and an error to log; the second needs the run's
-- input and output kept, and a link from the rerun back to the original.
--
-- CLAUDE.md fail-loudly: every gateway call writes exactly one row here,
-- successful or not. A component that raises has a run_log row explaining why.

create type public.run_status as enum ('ok', 'error');

-- Why a run failed. Mirrors GatewayFailureKind in lib/llm/errors.ts.
-- If you change one, change both.
create type public.run_error_kind as enum (
  'not_configured',
  'auth',
  'rate_limited',
  'provider_error',
  'unparseable',
  'schema',
  'tools_unsupported',
  'timeout'
);

alter table public.run_log
  add column provider public.llm_provider,
  add column status public.run_status not null default 'ok',
  add column error_kind public.run_error_kind,
  add column error_message text,
  -- 1 = succeeded first try, 2 = succeeded or failed after the single retry.
  add column attempts smallint not null default 1,
  -- Set when this run was produced by "Rerun with model X" in Settings, so the
  -- UI can pair the two runs for side-by-side comparison.
  add column rerun_of uuid references public.run_log (id) on delete set null;

-- input_ref and output_ref hold the JSON payloads inline rather than a pointer
-- to storage. The rerun comparison needs the original input to re-execute and
-- both outputs to display, and these payloads are small (a persona, a page of
-- extracted events). Revisit if event_extraction inputs grow large.
comment on column public.run_log.input_ref is
  'Gateway input as JSON text. Kept inline so a run can be re-executed.';
comment on column public.run_log.output_ref is
  'Validated gateway output as JSON text, or the raw reply when validation failed.';

create index run_log_rerun_of_idx on public.run_log (rerun_of)
  where rerun_of is not null;

create index run_log_user_component_idx
  on public.run_log (user_id, component, created_at desc);
