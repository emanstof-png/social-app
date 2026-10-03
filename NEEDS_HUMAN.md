# NEEDS HUMAN: spec 20 item 1

## What is needed
Network access for npx vibe-kanban's own binary download (separate from the npm registry fetch, which succeeded). Diagnose and fix on this machine: run 'npx vibe-kanban' by hand and see exactly which host/URL it downloads from, then confirm that host is reachable (proxy/firewall/TLS-intercept configuration) -- or install vibe-kanban a different way (e.g. a prebuilt binary release) if its own installer cannot work here.

## What the session did before stopping
Added the npx vibe-kanban allowlist entry (done in the prior session) and ran npx vibe-kanban for real, both inside and outside the Bash sandbox (dangerouslyDisableSandbox: true). Both runs printed the same failure: 'Download failed: write EPROTO ...SSL routines:tls_validate_record_header:wrong version number...' -- vibe-kanban's own self-installer fetches a second binary after the npm package resolves, and that fetch fails on a TLS/SSL mismatch, not a missing-package or allowlist problem (the npm registry fetch for the vibe-kanban package itself succeeded both times). Did not attempt further workarounds (e.g. installing from an alternate source) since that would be guessing at network/TLS configuration on a machine I cannot otherwise inspect -- printenv/curl diagnostics required approval this session has no one to grant.

## Written by
`scripts/needs-human.ts`, 2026-10-03T20:44:14.156Z
