-- gazelle spec 01 — enums
-- Every enum below is taken verbatim from docs/ARCHITECTURE.md "Data model".
-- The one exception is record_status, added so the CLAUDE.md hard rule
-- "never delete communities/events/contacts, archive instead" has a column to
-- write to on events and contacts (communities already carries 'archived' in
-- its own status enum).

create type public.activity_source as enum ('assessment', 'suggested', 'user');
create type public.activity_status as enum ('active', 'benched', 'cut');

create type public.community_type as enum ('community_event', 'community_general', 'one_off_source');
create type public.calendar_kind as enum ('ics', 'html', 'api', 'manual');
create type public.community_status as enum ('todo', 'went_once', 'returning', 'cut', 'archived');

create type public.event_type as enum ('community_event', 'community_general', 'one_off');

create type public.selection_status as enum ('planned', 'attended', 'skipped');

create type public.preference_entity_type as enum ('genre', 'community', 'venue');

create type public.interaction_kind as enum ('met', 'text', 'invite', 'hangout');

create type public.invite_suggestion_status as enum ('suggested', 'sent', 'dismissed');

-- Components that call the LLM gateway (docs/ARCHITECTURE.md, "Component -> gateway contract").
create type public.llm_component as enum (
  'interview',
  'persona_synthesis',
  'activity_suggestion',
  'discovery_research',
  'event_extraction',
  'weekly_planning',
  'invite_suggestion'
);

-- Providers the gateway speaks to (docs/ARCHITECTURE.md, "Stack").
create type public.llm_provider as enum ('anthropic', 'openrouter', 'groq', 'gemini', 'local');

-- Archive-instead-of-delete marker for events and contacts.
create type public.record_status as enum ('active', 'archived');
