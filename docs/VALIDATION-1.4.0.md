# Scopearr 1.4.0 validation

Validated on 2026-10-23 against main `34117dc` (1.3.3).

- Frontend: frozen pnpm 11.25.0 installation, TypeScript 5.9.3 check, **102 tests**, production build and moderate-or-higher audit pass. The existing large language-data/catalog chunk warning remains; no vulnerabilities were reported.
- Backend: Go 1.27.3 `go test -race ./...` and `go vet ./...` pass in Linux; Staticcheck v0.8.2 (`-checks=all,-ST*`) passes. `gofmt -l internal cmd` produces no paths. Existing session fixtures now name their insert columns for the additive schema change.
- Release scripts: seven Python tests pass. VERSION, frontend package, both Docker arguments and release notes agree on 1.4.0.
- Full container image builds. The read-only demo container passes its healthcheck as UID 99:GID 100 with 512 MiB memory and no additional swap. Publishing remains gated by GitHub Checks and Approved release, which also perform vulnerability scans, both architecture smoke tests and the 100,000-file check.

## Interface and behavior

The isolated UID 99 fixture uses tmpfs disks, long titles/paths, movies/shows/documentaries roots, four-disk placement, more than ten file findings and every mux status. No private library data is included. Evidence is retained under ignored `work/ui140/`.

- **480 app views** cover dashboard, movies, TV, all six settings sections, all five configured service tabs, and collapsed/expanded tool panels at 1440 / 1180 / 1024 / 820 / 600 / 375px. Modes/palettes: default dark/light, Linen light and Copper dark. No browser errors or document overflow. Actual font sizes use the seven-step scale plus the documented 28px mobile stat number. All visible checkbox measurements are 16 × 16px.
- **264 dialog views** cover placement details/status/terminal, file-check details/commands, mux options/status/terminal/path checks, file metadata and discard confirmation in Chromium and WebKit, light/dark at all six widths. All fit the viewport.
- **48 additional views** cover recognition rule editing, reset confirmation and synthetic tag review/policy dialogs. Checkbox/radio measurements are 16 × 16px; keyboard focus stays in the rule dialog.
- **90 removals**: three completed entries per tool, Chromium and WebKit, at 1440 / 1180 / 1024 / 820 / 375px. Measured header widths do not change; remaining rows stay exactly 64px (56px on the phone). Full values are in `layout-proof.json`. Phone detail dialogs retain start/fix, terminal and mux options handlers.
- Root coverage exposes three unmapped documentaries, accepts the server-generated mapping, highlights the manual Scan action and clears the stale missing-mapping notice. After scanning, the Share filter returns exactly three documentaries; its chip and reset work. Movies, shows and documentaries are detected from roots rather than hard-coded.
- A nine-state mux fixture plus completed rows reports exactly seven open jobs. Completed/cancelled jobs and unstarted findings do not count as queued work. Backend tests cover unknown future states and all three job sources.
- Three simulated status 503 responses keep the authenticated files view and show one connection notice; recovery clears it. Two confirmed unauthenticated responses show the expiry message. Signing in restores Files & permissions on page 2. Backend tests cover seven-day cookies, hourly renewal, 30-day cap, legacy sessions, failed renewal writes and 503 on database read errors.
- Every existing component remains. The baseline button inventory has **187 declarations in 45 components**; those same components now have **197**, plus the new root-coverage controls. Existing filters, configurable columns, sort cycles, settings, confirmations and processing handlers remain available. Files & permissions now sorts Progress through its existing backend progress column. All original behavioral regression tests pass.
- Color/source checks find no unapproved raw interface colors. Fixed media palettes and terminal colors are marked. Icons use `ICON`; the three override stylesheets are gone. Source checks also preserve dynamically constructed column/toast classes.

## Implementation decisions

- The stylesheet consolidation and scale migrations are grouped by area to preserve the final cascade. Structural geometry uses a documented `--layout-*` token family; typography, spacing, radii and controls retain their prescribed scales. Existing library tables retain their configurable layout because they do not remove job rows; tool tables have the fixed geometry.
- 1100px placement grouping maps to 1120px. Intermediate 1000/850/800px grids map to 900px; 700px two-column/tag/help layouts map to 740px; 650px phone controls map to 600px. Each affected area is covered by the six-width matrix.
- Node 26 is still Current on the release date and starts LTS on 2026-10-28, according to the official Node release schedule. Per the release plan, Docker and CI use Node **24.22.1 LTS** instead; PR #10 stays open. TypeScript #9 also stays open at 5.9.3 with the maintainer-approved deferral comment. Approved Preact, Lucide and Actions updates are included with their exact pinned SHAs. Docker login/buildx inputs were checked against the new action definitions.
- GitHub's x86 runner exceeded Go's default ten-minute package deadline while still progressing through existing tests; the full Linux suite passes locally in 312.780 seconds. CI and Approved release now explicitly allow 20 minutes for the complete race-instrumented suite. Assertions, race detection and all release gates remain enabled.
- The hosted race run exposed an existing 25ms success-fixture deadline in `TestFileRenameSuccess`, covering Arr HTTP, durable queueing and a media notification. The fixture now permits two seconds for successful refreshes; the two deliberate pending cases explicitly use 250ms. All response, notification, filesystem and queue assertions remain; production rename/rescan logic is unchanged.
- Dependency-only production output changed from the baseline index chunk 510.58 kB / 144.54 kB gzip to 513.00 kB / 145.42 kB gzip. Final output also includes the new catalogs, coverage UI and session feedback; the final build sizes are recorded in the PR.
- SameSite is Lax for top-level cross-site navigation; authenticated mutations still require the existing CSRF header and same-origin validation. HttpOnly and HTTPS Secure behavior remain. The only migration is additive `sessions.created`; rollback to 1.3.3 remains supported. Container budget stays 512 MB.

All commits use Buffer379x without assistant authors or trailers. Release publication requires successful CI for the exact main commit before Approved release can tag and promote it.
