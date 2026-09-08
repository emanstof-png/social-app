/**
 * The assessment catalogue (PRD §1.1: "the app looks through a catalogue of
 * assessments and picks relevant ones").
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule). The interview UI is a client
 * component and the scorer runs on the server, and both import from here. A
 * plain value exported across a "use client" boundary reaches the server as a
 * client-reference proxy rather than the real array, so `.map` is undefined --
 * in production only, not in dev and not in `next build`. That exact bug hit
 * NAV_ITEMS in spec 01. Never add "use client" or "use server" to this file.
 *
 * WORDING. Every item below is written for gazelle. The published DISC and
 * Enneagram instruments are licensed products and none of their items appear
 * here; the two inventories modelled on those traditions measure the same
 * families of behaviour in original language. The short Big Five is adapted
 * from the public-domain IPIP pool.
 *
 * SCORING IS CODE, NEVER A MODEL CALL. `scoreInventory` is pure, so scores are
 * recomputed from the stored raw answers on every read and nothing about a
 * result needs a database column of its own (spec 03, "Decisions made while
 * drafting").
 *
 * ABOUT-YOU IS STATIC (spec 03 rework addendum). The interview used to open
 * with an LLM writing hobbies questions one at a time, then close with these
 * five fixed constraint questions. Both are fixed text now, in one static
 * section, and the model is called exactly once afterward -- to pick which
 * inventories run in the phase below -- not per question. The five constraint
 * questions keep their original wording verbatim: specs 05 and 06 filter on
 * these answers, so what they mean has to stay stable across the rework.
 */

/** Every item is a 1-5 agreement rating, so one response widget serves all. */
export const RESPONSE_MIN = 1;
export const RESPONSE_MAX = 5;

export const RESPONSE_CHOICES: readonly string[] = [
  "Strongly disagree",
  "Disagree",
  "Neither",
  "Agree",
  "Strongly agree",
] as const;

export type InventoryItem = {
  id: string;
  text: string;
  /** The scale this item loads onto. */
  scale: string;
  /** Agreement counts against the scale rather than for it. */
  reverse?: boolean;
};

export type InventoryScale = {
  key: string;
  label: string;
  /** Shown next to the score, one sentence per band. */
  bands: { low: string; moderate: string; high: string };
};

export type Inventory = {
  id: string;
  name: string;
  /** What the inventory measures, in a sentence the user can read. */
  measures: string;
  scales: readonly InventoryScale[];
  items: readonly InventoryItem[];
};

export type Band = "low" | "moderate" | "high";

export type ScaleScore = {
  key: string;
  label: string;
  /** Items on this scale that were answered. */
  answered: number;
  total: number;
  /** 0-100 across the answered items, or null when none were answered. */
  percent: number | null;
  band: Band | null;
  description: string;
};

export type InventoryResult = {
  id: string;
  name: string;
  measures: string;
  answered: number;
  total: number;
  scales: ScaleScore[];
};

/** Raw responses, keyed by item id. */
export type InventoryResponses = Record<string, number>;

// -- About-you (spec 03 rework addendum) --------------------------------------

export type AboutYouInputKind = "text" | "single_choice";

export type AboutYouQuestion = {
  key: string;
  text: string;
  help?: string;
  inputKind: AboutYouInputKind;
  choices?: string[];
};

/**
 * The whole about-you section: static, instant, no LLM call. Order here is
 * interview order. The last four keys (`budget` through `schedule`) are
 * spec 03's original `CONSTRAINT_QUESTIONS`, moved here unchanged in wording
 * and key so specs 05 and 06's filters keep working.
 */
export const ABOUT_YOU_QUESTIONS: readonly AboutYouQuestion[] = [
  {
    key: "hobby",
    text: "Name one or two things you're into right now, hobby-wise -- or used to be.",
    help: "Doesn't have to be impressive. Whatever you'd actually mention if someone asked.",
    inputKind: "text",
  },
  {
    key: "good_week",
    text: "What does a good week look like for you, socially?",
    inputKind: "text",
  },
  {
    key: "current_environment",
    text: "Think about the social environments you're actually in most right now -- work, family, whatever's regular. What are they like?",
    inputKind: "text",
  },
  {
    key: "desired_environment",
    text: "Now the other direction: what do you want more of, socially, that you're not getting?",
    inputKind: "text",
  },
  {
    key: "budget",
    text: "What can you comfortably spend on this in a typical month?",
    help: "Plenty of good groups are free. This just stops us suggesting things you would resent paying for.",
    inputKind: "single_choice",
    choices: [
      "Nothing — free events only",
      "Up to about $25 a month",
      "Up to about $50 a month",
      "Up to about $100 a month",
      "More than $100 a month",
    ],
  },
  {
    key: "sobriety",
    text: "Does alcohol change whether a group suits you?",
    inputKind: "single_choice",
    choices: [
      "I need alcohol-free settings",
      "I would rather drinking was not the point",
      "It makes no difference to me",
      "I would rather a drink was on offer",
    ],
  },
  {
    key: "physical",
    text: "Is there anything physical we should plan around — mobility, hearing, sight, energy, an injury?",
    help: "Write “nothing” if there is nothing.",
    inputKind: "text",
  },
  {
    key: "location",
    text: "Where should we look, and how far are you willing to travel?",
    help: "A town or city and a rough radius or travel time is enough.",
    inputKind: "text",
  },
  {
    key: "schedule",
    text: "When are you actually free?",
    help: "Weeknights, weekend mornings, Tuesday lunchtimes — be as specific as you can.",
    inputKind: "text",
  },
] as const;

// -- The inventories ----------------------------------------------------------

const behaviouralProfile: Inventory = {
  id: "behavioural_profile",
  name: "Behavioural profile",
  measures:
    "How you behave in a group: whether you drive, persuade, steady or check. " +
    "Useful for guessing which rooms will suit you.",
  scales: [
    {
      key: "drive",
      label: "Drive",
      bands: {
        low: "You rarely take the wheel, and you are comfortable letting others set the pace.",
        moderate: "You will take charge when it is needed, but you do not reach for it.",
        high: "You take charge quickly and are comfortable pushing a group to decide.",
      },
    },
    {
      key: "influence",
      label: "Influence",
      bands: {
        low: "You persuade by doing rather than by talking a room around.",
        moderate: "You can carry a room when you care about the subject.",
        high: "You bring people with you by enthusiasm, and you enjoy doing it.",
      },
    },
    {
      key: "steadiness",
      label: "Steadiness",
      bands: {
        low: "You like change and short-notice plans more than routine.",
        moderate: "You value a settled rhythm but can break it without much cost.",
        high: "You hold a group together and prefer a steady, familiar rhythm.",
      },
    },
    {
      key: "precision",
      label: "Precision",
      bands: {
        low: "You act on partial information rather than wait for the detail.",
        moderate: "You check what matters and let the rest go.",
        high: "You want the detail right before you commit, and it shows in your choices.",
      },
    },
  ],
  items: [
    { id: "bp1", scale: "drive", text: "When a group stalls, I am usually the one who decides what happens next." },
    { id: "bp2", scale: "drive", text: "I would rather push for a fast decision than wait until everyone agrees." },
    { id: "bp3", scale: "drive", text: "I am comfortable telling someone directly that I disagree with them." },
    { id: "bp4", scale: "influence", text: "I enjoy talking a room around to an idea I believe in." },
    { id: "bp5", scale: "influence", text: "Meeting a lot of new people energises me more than it tires me." },
    { id: "bp6", scale: "influence", text: "I get people moving with enthusiasm rather than with pressure." },
    { id: "bp7", scale: "steadiness", text: "I would rather keep a settled routine than change plans at short notice." },
    { id: "bp8", scale: "steadiness", text: "People come to me when they want someone who will simply listen." },
    { id: "bp9", scale: "steadiness", text: "Keeping a group on good terms with each other matters a lot to me." },
    { id: "bp10", scale: "precision", text: "I check the details before I commit to anything." },
    { id: "bp11", scale: "precision", text: "Getting something right matters more to me than getting it done quickly." },
    { id: "bp12", scale: "precision", text: "I am uneasy acting before I have clear information." },
  ],
};

const bigFive: Inventory = {
  id: "big_five",
  name: "Short Big Five",
  measures:
    "The five broad personality dimensions, in a ten-item form adapted from " +
    "the public-domain IPIP pool.",
  scales: [
    {
      key: "openness",
      label: "Openness",
      bands: {
        low: "You prefer the familiar, and novelty for its own sake holds little appeal.",
        moderate: "You try new things when there is a reason to.",
        high: "You are pulled towards the unfamiliar and enjoy ideas for their own sake.",
      },
    },
    {
      key: "conscientiousness",
      label: "Conscientiousness",
      bands: {
        low: "You work in bursts and keep things loose.",
        moderate: "You finish what matters and let the rest slide.",
        high: "You finish what you start and keep your commitments ordered.",
      },
    },
    {
      key: "extraversion",
      label: "Extraversion",
      bands: {
        low: "You take your energy from quiet and from a few people at a time.",
        moderate: "You are sociable in the right setting and content alone in others.",
        high: "You seek company out and start conversations easily.",
      },
    },
    {
      key: "agreeableness",
      label: "Agreeableness",
      bands: {
        low: "You are direct and unsentimental, and you say what you think of people.",
        moderate: "You are warm with people who have earned it.",
        high: "You go out of your way to make other people comfortable.",
      },
    },
    {
      key: "emotional_stability",
      label: "Emotional stability",
      bands: {
        low: "Setbacks stay with you, so a group that feels safe will matter more than a lively one.",
        moderate: "You are shaken by some things and steady through most.",
        high: "You stay level when things go wrong.",
      },
    },
  ],
  items: [
    { id: "bf1", scale: "openness", text: "I am drawn to experiences that are unfamiliar to me." },
    { id: "bf2", scale: "openness", reverse: true, text: "I have little interest in abstract or theoretical questions." },
    { id: "bf3", scale: "conscientiousness", text: "I finish what I start, even after the novelty wears off." },
    { id: "bf4", scale: "conscientiousness", reverse: true, text: "I tend to leave my belongings and my plans in a mess." },
    { id: "bf5", scale: "extraversion", text: "I start conversations with people I have not met before." },
    { id: "bf6", scale: "extraversion", reverse: true, text: "I stay in the background at social gatherings." },
    { id: "bf7", scale: "agreeableness", text: "I go out of my way to make other people comfortable." },
    { id: "bf8", scale: "agreeableness", reverse: true, text: "I am quick to find fault with people." },
    { id: "bf9", scale: "emotional_stability", text: "I stay calm when things go wrong." },
    { id: "bf10", scale: "emotional_stability", reverse: true, text: "Small setbacks leave me in a bad mood for a while." },
  ],
};

const coreMotivations: Inventory = {
  id: "core_motivations",
  name: "Core motivations",
  measures:
    "Nine recurring drives -- what you are reaching for underneath the " +
    "behaviour. Written for gazelle in the tradition of motivation-type " +
    "inventories rather than taken from any published one.",
  scales: [
    {
      key: "integrity",
      label: "Doing it right",
      bands: {
        low: "You are relaxed about standards.",
        moderate: "You hold a standard without making it the point.",
        high: "You hold yourself to a strict standard, and groups that are sloppy will grate.",
      },
    },
    {
      key: "helpfulness",
      label: "Being needed",
      bands: {
        low: "You do not organise yourself around other people's needs.",
        moderate: "You help when asked and do not go looking for it.",
        high: "You notice what people need before they ask; look for groups that give that somewhere to go.",
      },
    },
    {
      key: "achievement",
      label: "Getting somewhere",
      bands: {
        low: "You do not measure yourself by output.",
        moderate: "You like progress without needing it noticed.",
        high: "You measure a good week by what you finished and who saw it.",
      },
    },
    {
      key: "authenticity",
      label: "Being yourself",
      bands: {
        low: "Fitting in costs you nothing.",
        moderate: "You adapt to a room without losing yourself in it.",
        high: "You would rather be unmistakably yourself than comfortably included.",
      },
    },
    {
      key: "understanding",
      label: "Understanding first",
      bands: {
        low: "You join in and work it out as you go.",
        moderate: "You like some grounding before you commit.",
        high: "You want to understand a thing thoroughly before you take part; expect a slow start in new groups.",
      },
    },
    {
      key: "security",
      label: "Knowing where you stand",
      bands: {
        low: "You are untroubled by not knowing how something will go.",
        moderate: "You think ahead without dwelling on it.",
        high: "You work out what could go wrong in advance, and trust is built slowly.",
      },
    },
    {
      key: "possibility",
      label: "Keeping options open",
      bands: {
        low: "You commit and stop looking.",
        moderate: "You commit but keep an eye out.",
        high: "You keep options open in case something better appears -- the main risk to a regular commitment.",
      },
    },
    {
      key: "agency",
      label: "Standing on your own",
      bands: {
        low: "You lean on people easily.",
        moderate: "You are self-reliant without making a principle of it.",
        high: "You would rather rely on your own strength than depend on anyone.",
      },
    },
    {
      key: "harmony",
      label: "Keeping the peace",
      bands: {
        low: "You will have the argument.",
        moderate: "You pick your conflicts.",
        high: "You give up what you want to avoid a conflict, so watch for groups that quietly do not suit you.",
      },
    },
  ],
  items: [
    { id: "cm1", scale: "integrity", text: "I hold myself to a standard most people would call strict." },
    { id: "cm2", scale: "helpfulness", text: "I notice what people need before they ask, and I act on it." },
    { id: "cm3", scale: "achievement", text: "I measure a good week by what I got done and who noticed." },
    { id: "cm4", scale: "authenticity", text: "I would rather be unmistakably myself than comfortably fit in." },
    { id: "cm5", scale: "understanding", text: "I want to understand something thoroughly before I take part in it." },
    { id: "cm6", scale: "security", text: "I think through what could go wrong so that I am not caught out." },
    { id: "cm7", scale: "possibility", text: "I keep my options open because I do not want to miss something better." },
    { id: "cm8", scale: "agency", text: "I would rather rely on my own strength than depend on anyone." },
    { id: "cm9", scale: "harmony", text: "I will give up what I want in order to avoid a conflict." },
  ],
};

const socialStyle: Inventory = {
  id: "social_style",
  name: "Social style",
  measures:
    "How you actually behave around groups: how outward you are, whether you " +
    "organise, and how readily you walk into something new.",
  scales: [
    {
      key: "outward",
      label: "Outward",
      bands: {
        low: "Company costs you energy, so a few small recurring groups will beat a busy calendar.",
        moderate: "You enjoy company in the right dose.",
        high: "Company gives you energy; a full calendar suits you.",
      },
    },
    {
      key: "organizer",
      label: "Organiser",
      bands: {
        low: "You would rather be told where to turn up.",
        moderate: "You will organise when nobody else does.",
        high: "You end up running things; groups that need a convenor will take you in fast.",
      },
    },
    {
      key: "joiner",
      label: "Joiner",
      bands: {
        low: "You need a way in -- an introduction or a friend already there.",
        moderate: "You will try something new when the way in is clear.",
        high: "You walk into a room of strangers without much trouble.",
      },
    },
  ],
  items: [
    { id: "ss1", scale: "outward", text: "A long evening with a lot of people leaves me energised rather than drained." },
    { id: "ss2", scale: "outward", reverse: true, text: "I would rather spend a free evening on my own than out." },
    { id: "ss3", scale: "outward", text: "I talk to strangers easily in queues, gyms and waiting rooms." },
    { id: "ss4", scale: "outward", reverse: true, text: "I need a quiet day to recover after a busy social weekend." },
    { id: "ss5", scale: "organizer", text: "If nobody organises the group, I end up doing it." },
    { id: "ss6", scale: "organizer", text: "I like being the one who picks the place and sends the invitation." },
    { id: "ss7", scale: "organizer", text: "I keep track of who has not been included lately." },
    { id: "ss8", scale: "organizer", reverse: true, text: "I would rather be told where to turn up than plan it myself." },
    { id: "ss9", scale: "joiner", text: "I am happy to walk into a group where I know nobody." },
    { id: "ss10", scale: "joiner", text: "Once I commit to a regular group, I keep showing up." },
    { id: "ss11", scale: "joiner", reverse: true, text: "I need an introduction before I will try a new group." },
    { id: "ss12", scale: "joiner", text: "Trying an activity for the first time appeals to me more than it worries me." },
  ],
};

export const ASSESSMENT_CATALOGUE: readonly Inventory[] = [
  behaviouralProfile,
  bigFive,
  coreMotivations,
  socialStyle,
] as const;

export const CATALOGUE_IDS = ASSESSMENT_CATALOGUE.map(
  (inventory) => inventory.id,
) as [string, ...string[]];

export function isCatalogueId(value: string): boolean {
  return ASSESSMENT_CATALOGUE.some((inventory) => inventory.id === value);
}

/** Raises rather than returning undefined, so a bad id fails at the call site. */
export function inventoryById(id: string): Inventory {
  const found = ASSESSMENT_CATALOGUE.find((inventory) => inventory.id === id);
  if (!found) {
    throw new Error(
      `No inventory "${id}" in the assessment catalogue. Known ids: ` +
        `${CATALOGUE_IDS.join(", ")}.`,
    );
  }
  return found;
}

/** A one-line summary of each inventory, for the interview component's prompt. */
export function catalogueSummary(): { id: string; name: string; measures: string }[] {
  return ASSESSMENT_CATALOGUE.map(({ id, name, measures }) => ({
    id,
    name,
    measures,
  }));
}

function bandFor(percent: number): Band {
  if (percent < 40) return "low";
  if (percent < 70) return "moderate";
  return "high";
}

/**
 * Scores one inventory. Pure: no clock, no randomness, no I/O, no model call.
 *
 * Unanswered items are left out rather than treated as a neutral response, so a
 * partly finished inventory reports what it actually knows. A response outside
 * the 1-5 range raises (CLAUDE.md: fail loudly) rather than being clamped.
 */
export function scoreInventory(
  inventoryId: string,
  responses: InventoryResponses,
): InventoryResult {
  const inventory = inventoryById(inventoryId);

  const scales: ScaleScore[] = inventory.scales.map((scale) => {
    const items = inventory.items.filter((item) => item.scale === scale.key);

    let raw = 0;
    let answered = 0;

    for (const item of items) {
      const value = responses[item.id];
      if (value === undefined || value === null) continue;

      if (
        !Number.isInteger(value) ||
        value < RESPONSE_MIN ||
        value > RESPONSE_MAX
      ) {
        throw new Error(
          `Response ${value} for item "${item.id}" is outside the ` +
            `${RESPONSE_MIN}-${RESPONSE_MAX} scale.`,
        );
      }

      raw += item.reverse ? RESPONSE_MIN + RESPONSE_MAX - value : value;
      answered += 1;
    }

    if (answered === 0) {
      return {
        key: scale.key,
        label: scale.label,
        answered: 0,
        total: items.length,
        percent: null,
        band: null,
        description: "Not answered yet.",
      };
    }

    const min = answered * RESPONSE_MIN;
    const max = answered * RESPONSE_MAX;
    const percent = Math.round(((raw - min) / (max - min)) * 100);
    const band = bandFor(percent);

    return {
      key: scale.key,
      label: scale.label,
      answered,
      total: items.length,
      percent,
      band,
      description: scale.bands[band],
    };
  });

  return {
    id: inventory.id,
    name: inventory.name,
    measures: inventory.measures,
    answered: scales.reduce((sum, scale) => sum + scale.answered, 0),
    total: inventory.items.length,
    scales,
  };
}
