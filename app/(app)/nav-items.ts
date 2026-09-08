/**
 * The sections of the app (spec 01, scope item 4 -- originally eight;
 * `/calendar` was folded into `/feed` as one merged view by the PRD §2.5
 * fix, 2026-09-08, leaving seven).
 *
 * Deliberately NOT in nav.tsx. That file is a client component, and a plain
 * value exported across a "use client" boundary reaches a Server Component as a
 * client-reference proxy rather than the real array, so `.map` is undefined.
 * The production build fails that way while dev works, because dev also
 * evaluates the module on the server. Keep shared constants in a module with no
 * "use client" so both sides get the actual value.
 */
export const NAV_ITEMS = [
  { href: "/assessment", label: "Assessment" },
  { href: "/activities", label: "Activities" },
  { href: "/communities", label: "Communities" },
  { href: "/feed", label: "Feed" },
  { href: "/evaluations", label: "Evaluations" },
  { href: "/people", label: "People" },
  { href: "/settings", label: "Settings" },
] as const;
