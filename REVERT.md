# REVERT

How to undo each spec, if one turns out to be wrong. Read the whole entry before
running anything.

Two things always have to be undone separately:

- **Code** lives in git and reverts cleanly.
- **Database** lives in Supabase and does not. Migrations are forward-only; undoing
  one means writing and applying a new migration that drops what the old one made.

---

## spec-01 — scaffold and data model

Tag: `spec-01`. Previous state: commit `af32870` ("rename to gazelle"), which is
docs only, no application code.

### Code

```bash
# Look at what would change first.
git diff af32870..spec-01 --stat

# Undo, keeping the history (safe, no force push).
git revert --no-commit af32870..spec-01
git commit -m "revert spec 01"
git push origin main
```

Deleting the untracked build output afterwards is optional but tidy:
`rm -rf .next node_modules`.

### Database

Reverting the code does **not** empty Supabase. To take project
`wqawpwbgrsjusbdopgbi` back to empty, apply this as a new migration:

```sql
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists
  public.invite_suggestions, public.interactions, public.contacts,
  public.preference_log, public.evaluations, public.selections,
  public.events, public.communities, public.activities,
  public.assessments, public.assessment_answers, public.run_log,
  public.model_settings, public.provider_keys, public.profiles
  cascade;

drop function if exists public.set_updated_at();

drop type if exists
  public.record_status, public.llm_provider, public.llm_component,
  public.invite_suggestion_status, public.interaction_kind,
  public.preference_entity_type, public.selection_status, public.event_type,
  public.community_status, public.calendar_kind, public.community_type,
  public.activity_status, public.activity_source;
```

**This destroys data.** At the end of spec 01 the tables are empty, so it costs
nothing. Once real assessments, communities or contacts exist, export them first
and prefer a narrower migration that changes only what is wrong.

Signed-up users are untouched by the above; they live in `auth.users`. Removing
those is a separate step in the Supabase dashboard under Authentication → Users.

### Vercel

Nothing to undo. Rolling `main` back re-deploys the earlier state automatically.
To get back online faster, promote a previous deployment from the Vercel
dashboard instead of waiting on a fresh build.
