import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 otherwise appends its own block to CLAUDE.md / AGENTS.md on `next dev`.
  // CLAUDE.md is this project's hand-authored rules-of-record; keep it under our control.
  agentRules: false,
};

export default nextConfig;
