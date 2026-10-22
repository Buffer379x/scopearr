# Scopearr 1.3.2 validation

Validated on 2026-10-22 against the 1.3.1 release plan baseline.

- Frontend: TypeScript check, 90 Node tests (including translations, repeated query values, corrupted preferences, ordered filter chips, four-disk tones and effective mux status filtering), production Vite build.
- Backend: `go test -race ./...`, `go vet ./...`, and Staticcheck v0.8.2 with `-checks=all,-ST*` passed locally in Go 1.27.3. New HTTP tests cover OR within status/kind/target, AND between groups, single-value compatibility, invalid filters returning 400, and filtered Fix all excluding untracked video.
- Release scripts: seven Python unit tests; `scripts/check-version.mjs` confirms source/package/Docker/notes agree on 1.3.2.
- Container: local image built; read-only, capability-dropped demo passed health checks before and after restart as UID/GID 99:100 under a 512 MiB memory limit with no additional swap.
- Browser: isolated UID 99 fixture with tmpfs disks, three-disk items, nine file findings and ten mux fixtures. Light and dark themes at 1440, 1024 and 375 px; no page-level horizontal overflow. Filter groups use three/four desktop columns, two at 1024, one at 375. Screenshots and measured layout matrix remain under ignored `work/ui132/`.
- Placement: combined Mover + Conflict filters, stable chip order independent of click order, search, persisted choices after reload, target selection from summary, information popover and visible neutral disk tags. A real fixture move completed; progress/removal headers remained exactly 150/56 px.
- Files: combined Kind + Status filters produced three matching findings. Fix all confirmed three and preserved both untracked fixture videos. Completed/dependent findings remained visible after reset; progress/removal headers stayed exactly 150/56 px. Details explanation/spacing checked in both themes and on mobile; rules button appears below Libraries.
- Mux: effective status counts across ten fixtures, combined status filters and case-insensitive filename search, correct no-match state, header selection restricted to visible startable jobs, collapse control and global-action tooltip. A simulated running-to-successful fixture transition preserved 150/56 px progress/removal headers and exposed the green remove button.
- Login: centered artwork with no marketing text, no header caption, title `Scopearr`, mobile artwork hidden as before; all four catalogs agree.

No schema migration or rollback restriction. GitHub Checks and Approved release independently gate publication, including dependency/runtime vulnerability scans, both Linux architectures and the 100k-file container check.

Additional navigation validation: the real NavMenu component was exercised in an isolated browser fixture with zero, one and two destinations for Movies, TV series and Tools. Single destinations open directly without popup semantics; multiple destinations retain click/arrow-key selection and Escape handling. Switching an open menu to a single destination closes the old popup. Verified light/dark views at desktop, 1024 and 375 px. TypeScript, all 90 frontend tests and the production build passed after the change.
