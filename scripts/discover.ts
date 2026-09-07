/**
 * Runs the discovery loop from the command line, writing nothing.
 *
 *   npm run discover -- --dry-run --activity "contra dance"
 *   npm run discover -- --dry-run --activity "rucking" --location "Arlington, VA"
 *   npm run discover -- --dry-run --activity "contra dance" --user <uuid> --rounds 2
 *
 * CLAUDE.md: every scheduled job is runnable standalone with --dry-run -- full
 * logic, no writes. This is that, and it is how items 3-6 get exercised against
 * the real search APIs and real models without touching the database.
 *
 * --dry-run is REQUIRED. Spec 05 puts every real run behind a user action on
 * /communities (unattended discovery is spec 11), so there is deliberately no
 * writing mode here to invoke by accident.
 *
 * With --user it reads that user's stored communities and model_settings, so
 * the idempotent merge is exercised against real rows. It still never writes:
 * applyPlan and saveRun print instead. Confirm with a row count before and
 * after.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { MAX_ROUNDS } from "../lib/discovery/budget";
import { createPageFetcher } from "../lib/discovery/fetch";
import { nextStep, type ExistingCommunity, type RunState } from "../lib/discovery/research";
import { advanceRun, runOneRound, type RoundDeps } from "../lib/discovery/round";
import { readCommunitiesForActivity } from "../lib/discovery/round-server";
import { DEFAULT_MODEL_SETTINGS } from "../lib/llm/catalog";
import { callProviderDirect, runComponentWith, type GatewayDeps } from "../lib/llm/gateway";
import type { LlmComponent, LlmProvider } from "../lib/schemas/enums";
import { runSearch, type SearchDeps } from "../lib/search/chain";
import { noSearchProviderMessage } from "../lib/search/catalog";
import { searchCredential, hasAnySearchProvider } from "../lib/search/credentials";
import { searchAdapterFor } from "../lib/search/providers";

type Args = {
  dryRun: boolean;
  activity: string;
  location: string;
  rounds: number;
  userId: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    activity: "",
    location: "Arlington, Virginia",
    rounds: MAX_ROUNDS,
    userId: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--activity") {
      args.activity = value ?? "";
      i += 1;
    } else if (flag === "--location") {
      args.location = value ?? "";
      i += 1;
    } else if (flag === "--rounds") {
      args.rounds = Number(value ?? MAX_ROUNDS);
      i += 1;
    } else if (flag === "--user") {
      args.userId = value ?? null;
      i += 1;
    } else if (flag === "--help" || flag === "-h") {
      usage(0);
    }
  }

  return args;
}

function usage(code: number): never {
  console.log(
    [
      "Usage: npm run discover -- --dry-run --activity <name> [options]",
      "",
      "  --dry-run            Required. Runs the whole loop and writes nothing.",
      "  --activity <name>    The activity to find communities for. Required.",
      "  --location <place>   Where to search. Default: Arlington, Virginia.",
      "  --rounds <n>         How many rounds to attempt. Default: " + MAX_ROUNDS + ".",
      "  --user <uuid>        Read this user's stored communities and model",
      "                       settings, so the merge runs against real rows.",
      "                       Still writes nothing.",
    ].join("\n"),
  );
  process.exit(code);
}

/** Env-var name per model provider, for the no-database default. */
const PROVIDER_ENV: Partial<Record<LlmProvider, string>> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
};

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "--user needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * The gateway, wired to the environment rather than to model_settings when no
 * --user is given. run_log is printed, not written.
 */
function gatewayDeps(
  supabase: SupabaseClient | null,
  userId: string | null,
): GatewayDeps {
  return {
    resolveModel: async (component: LlmComponent) => {
      if (supabase && userId) {
        const { data } = await supabase
          .from("model_settings")
          .select("provider, model, supports_tools")
          .eq("user_id", userId)
          .eq("component", component)
          .maybeSingle();

        if (data) {
          return {
            provider: data.provider as LlmProvider,
            model: data.model as string,
            supports_tools: Boolean(data.supports_tools),
          };
        }
      }
      return DEFAULT_MODEL_SETTINGS[component];
    },

    resolveCredentials: async (provider: LlmProvider) => {
      const envVar = PROVIDER_ENV[provider];
      const apiKey = envVar ? (process.env[envVar] ?? null) : null;
      if (!apiKey) {
        throw new Error(
          `No API key for ${provider}. Set ${envVar ?? "its key"} in .env.local.`,
        );
      }
      return { provider, apiKey, baseUrl: null };
    },

    callProvider: callProviderDirect,

    logRun: async (record) => {
      console.log(
        `    run_log (not written): ${record.component} ` +
          `${record.provider}/${record.model} ${record.status} ` +
          `attempts=${record.attempts} ${record.latency_ms}ms` +
          (record.error_message ? ` — ${record.error_message.slice(0, 200)}` : ""),
      );
      return null;
    },
  };
}

function searchDeps(): SearchDeps {
  return {
    credentialFor: searchCredential,
    callProvider: (provider, query, credential, signal) =>
      searchAdapterFor(provider)(query, credential, signal),
    logSearch: async (record) => {
      console.log(
        `    search_log (not written): ${record.provider} ${record.status} ` +
          `results=${record.result_count ?? "-"} ${record.latency_ms}ms` +
          (record.error_message ? ` — ${record.error_message.slice(0, 160)}` : ""),
      );
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dryRun) {
    console.error(
      "Refusing to run without --dry-run.\n\n" +
        "Spec 05 puts every real discovery run behind a user action on " +
        "/communities, so this script has no writing mode. Add --dry-run.",
    );
    process.exit(2);
  }

  if (!args.activity) {
    console.error("--activity is required.\n");
    usage(2);
  }

  // The chain refuses rather than returning nothing, and says which variables
  // to set. Check it up front so the message arrives before any model spend.
  if (!hasAnySearchProvider()) {
    console.error(noSearchProviderMessage());
    process.exit(2);
  }

  const supabase = args.userId ? serviceClient() : null;

  console.log(
    `DRY RUN — activity "${args.activity}" near "${args.location}", ` +
      `up to ${args.rounds} rounds. Nothing will be written.\n`,
  );

  let existing: ExistingCommunity[] = [];
  if (supabase && args.userId) {
    const { data } = await supabase
      .from("activities")
      .select("id")
      .eq("user_id", args.userId)
      .ilike("name", args.activity)
      .maybeSingle();

    if (data?.id) {
      existing = await readCommunitiesForActivity(supabase, args.userId, data.id as string);
      console.log(
        `Read ${existing.length} stored communities for this activity; the ` +
          "merge below runs against them.\n",
      );
    } else {
      console.log(
        `No activity named "${args.activity}" for that user, so the merge runs ` +
          "against an empty list.\n",
      );
    }
  }

  const fetcher = createPageFetcher();
  const gateway = gatewayDeps(supabase, args.userId);
  const search = searchDeps();
  const allQueries: string[] = [];
  let pagesSeen: string[] = [];
  let wouldInsert = 0;

  let state: RunState = {
    status: "running",
    phase: "idle",
    roundsDone: 0,
    searchesUsed: 0,
    pagesRead: 0,
    emptyRounds: 0,
    communitiesFound: 0,
    lastError: null,
  };

  const deps: RoundDeps = {
    research: async (input) =>
      (await runComponentWith(gateway, "discovery_research", input)).output as never,
    extract: async (input) =>
      (await runComponentWith(gateway, "discovery_extraction", input)).output as never,
    search: (query) => runSearch({ query, maxResults: 6 }, search),
    isAllowed: (url) => fetcher.isAllowed(url),
    fetchPage: (url) => fetcher.fetchPage(url),
    loadExisting: async () => existing,
    loadPreviousQueries: async () => allQueries,
    applyPlan: async (plan) => {
      // The whole point of --dry-run: show the writes, make none of them.
      console.log(
        `\n  WOULD WRITE: ${plan.inserts.length} new, ${plan.updates.length} updated, ` +
          `${plan.dropped.length} dropped`,
      );
      for (const row of plan.inserts) {
        console.log(`    + ${row.name}  [${row.type}]`);
        console.log(`        where: ${row.location ?? "—"}   cost: ${row.cost ?? "—"}`);
        console.log(`        why:   ${row.why_relevant}`);
        console.log(`        from:  ${row.source_url}`);
        if (row.website) console.log(`        site:  ${row.website}`);
        if (row.calendar_url) console.log(`        cal:   ${row.calendar_url}`);
      }
      for (const row of plan.updates) {
        console.log(`    ~ ${row.name}: ${Object.keys(row.changes).join(", ")}`);
      }
      for (const row of plan.dropped) {
        console.log(`    - ${row.name}: ${row.reason}`);
      }
      for (const row of plan.ambiguous) {
        console.log(`    ? ${row.name}: ${row.reason}`);
      }
      wouldInsert += plan.inserts.length;
      // Reported as written so the run counters advance as they would in
      // production; nothing reached the database.
      return { inserted: plan.inserts.length, updated: plan.updates.length };
    },
    saveRun: async () => {
      // No discovery_runs row exists in a dry run.
    },
    onProgress: (message) => console.log(message),
  };

  for (let round = 1; round <= args.rounds; round += 1) {
    const step = nextStep(state);
    console.log(`\n===== round ${round} — next: ${step.step} (${step.why}) =====`);
    if (step.step === "stop") break;

    const report = await runOneRound(deps, {
      runId: "dry-run",
      activity: args.activity,
      location: args.location,
      round,
      focusNotes: "",
      run: state,
      previousRoundEmpty: state.emptyRounds > 0,
      previousRoundQueries: allQueries.slice(),
      pagesSeen,
    });

    allQueries.push(...report.queries);
    pagesSeen = [...new Set([...pagesSeen, ...report.pagesSeen])];
    state = advanceRun(state, report);

    console.log(`\n  outcome: ${report.outcome} — ${report.why}`);
    if (report.gaps.length) console.log(`  gaps: ${report.gaps.join(" | ")}`);
    console.log(`  state: ${JSON.stringify(state)}`);

    // A dry run must not pretend a found nothing run was a success, either.
    if (report.outcome === "failed") {
      console.error(`\nRound ${round} failed: ${report.why}`);
      break;
    }
  }

  const final = nextStep(state);
  console.log(`\n===== finished: ${final.why} =====`);
  console.log(
    `Would have written ${wouldInsert} communities. ` +
      `Searches used: ${state.searchesUsed}. Nothing was written to Supabase.`,
  );

  if (supabase && args.userId) {
    const { count } = await supabase
      .from("communities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", args.userId);
    console.log(`communities row count for that user, after this dry run: ${count}`);
  }
}

main().catch((error: unknown) => {
  // Fail loudly (CLAUDE.md): the real message, and a non-zero exit.
  console.error(`\nDiscovery failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
