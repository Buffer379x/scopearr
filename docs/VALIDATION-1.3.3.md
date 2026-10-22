# Scopearr 1.3.3 validation

Validated on 2026-10-22 against release 1.3.2.

- Frontend: TypeScript check, 96 Node tests and production build passed. Regression coverage includes target/source disk colors for three/four disks, an explicit target smaller than the largest share, deterministic fallback/ties, a single empty disk, pools, missing disks, footer sizing, collapse defaults and safe obsolete-preference removal. Existing 1.3.1/1.3.2 disk tests now assert the new semantics.
- Backend: Go 1.27.3 `go vet ./...`, `go test -race ./...` and Staticcheck v0.8.2 (`-checks=all,-ST*`) passed in the local toolchain container. `gofmt -l internal cmd` produced no paths.
- Release scripts: seven Python tests passed; source/package/both Docker defaults/release notes agree on 1.3.3.
- Browser: isolated UID 99 synthetic fixture with tmpfs disks, three/four-disk items, nine file findings and ten mux jobs. Before/after screenshots and measured geometry are retained under ignored `work/ui133/`. Checked light/dark themes at 1440, 1024 and 375 px; all 51 measured after views had no document overflow.
- Footer: reset/info/help controls measure 32 by 32 px with identical vertical centers, with and without active filters. Mux uses the same reset component. Active tags/search survive navigation while all tool panels reopen collapsed, including after reload and navigation back from the dashboard.
- Placement: actual scan rendered one green target and orange sources for three/four disks; target tags in the table and details are green, while detail tabs remain neutral. A synthetic no-space row with no target highlighted the largest existing share. A real fixture move completed and retained visible progress with the panel closed.
- Files: a manual owner finding showed identical 12px font, 19.2px line height, colors, padding, border and radius in explanation/notice boxes. Scan and fix progress remained visible with the panel closed. A synthetic junk-file fix completed.
- Removal columns: after the real placement move, file fix and seeded successful mux job, all three tables measured 80px removal columns and 29px of space to the right of the button at all tested widths and themes.
- Attribution: local commits use Buffer379x without assistant trailers. The remaining merge commit from `codex/attribution-base-1.3.2` is included; its complete source tree was already identical to main before this release.

No schema migration. Rollback to 1.3.2 is unrestricted. Publication remains gated by full GitHub Checks and Approved release, including both Linux architectures, vulnerability scans and the 100,000-file container check under the 512 MiB/no-additional-swap limit.
