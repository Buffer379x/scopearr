# Scopearr 1.4.1 validation

Validated on 2026-10-23 against release 1.4.0 (`b2107a1`). Evidence scripts, fixture data and full results remain in ignored `work/ui141/`; the selected images below contain synthetic data only.

## Automated checks

- Frontend: frozen pnpm installation, TypeScript check, **108 tests**, production build and moderate-or-higher audit pass. No known dependency vulnerabilities; the existing large-chunk advisory remains.
- Backend: Linux Go 1.27.3 full race suite passes (`internal/app`: 315.225 seconds), as do `go vet`, Staticcheck v0.8.2 and formatting checks. Govulncheck reports no affecting vulnerabilities; one required-module finding is outside called code.
- Release scripts: **seven Python tests** pass. VERSION, package version, both Docker arguments and release notes agree on 1.4.1.
- The 50,000-file performance fixture passes with two CPUs: main query p50 **40.88 ms**, p95 **73.87 ms**; TV size-descending median **53.07 ms**, resolution-descending **55.84 ms**. Custom-field fixture p95 is **92.56 ms**.
- Backend tests exercise share-scoped list queries, selected/all fix queues and streamed CSV, including unknown shares, sorting, pagination independence and spreadsheet formula escaping.

## Interface and behavior

The isolated tmpfs fixture includes movies/shows/documentaries shares, four-disk placement, an unmapped root with zero skipped files, multi-season series, unknown languages, twelve custom tags, file findings, real mux track controls and tool states. No private library data is used.

The before/after matrix contains **5,400 screenshots**: 1,260 before and 1,440 after per browser, Chromium and WebKit. Each view is covered at **1440 / 1180 / 1024 / 820 / 600 / 375 px**, with default/copper/linen in both dark and light modes. Dashboard, libraries, tools, settings, reports, metadata and action dialogs are included. Both baselines and final views have zero browser errors, document overflows or out-of-viewport dialogs. Final tables have no missing header scopes.

All five collapsed filter cards measure **158 px** at 1440 and 1024 px and **204 px** at 375 px. Search, preset, expansion and footer geometry match; Shares stays in expanded Libraries. Scan progress is below the results heading, including during a running scan.

Targeted checks in both browsers cover all TV sort cycles, restored grouping, independent library preferences, CSV order, tool preset save/select/confirmed deletion, missing-share recovery with named feedback, scoped file CSV, four-disk details, dashboard row alignment, tooltip hover/focus/Escape/viewport placement, coarse-pointer taps, segmented-tab keyboard/ARIA behavior, dirty indicators and sticky Save. Four-language checks verify non-wrapping table heads and 34 × 34 px editor controls. Mux track controls measure 28 px; recognition rows/actions measure 64 px. Empty disk data renders safely.

Settings document heights in pixels, default dark at 1440 px:

| View | 1.4.0 | 1.4.1 |
| --- | ---: | ---: |
| Services | 1643 | 1542 |
| Display / General | 4694 (all sections) | 801 |
| Display / Lists & columns | included above | 1121 |
| Display / Colors | included above | 1422 |
| Widgets | 1678 | 1032 |
| Custom tags | 1296 | 1165 |
| Tag rules | 1860 | 1877 |
| System | 689 | 713 |

The JSX button inventory changes from 200 to 188 declarations as repeated actions move into shared components. Counts alone are not functional evidence: the behavior checks and source comparison also map FilterRow/preset actions, CardHeading resets, OrderedList arrows, results Scan actions, footer report/info/help, password expansion and missing-mapping actions to their replacements. Existing handlers and processing safeguards remain available; Files & permissions adds the approved CSV action.

## Stylesheet regression audit

The audit compares eight computed properties on matching DOM paths in 1.3.3 and unchanged 1.4.0, dark/light at 1440/820/375 px, including dialogs. All **1,456** differences are classified against the 1.4.0 decisions; changed semantic DOM paths are not counted as matched nodes.

| Differences | Decision |
| ---: | --- |
| 4 | Fix D16 language chart cascade reversal |
| 654 | Retain D9 first-line checkbox alignment |
| 6 | Retain D21 notice wrapping |
| 2 | Retain D5 storage breakpoint at 1120 px |
| 790 | Retain D1–D5/D7–D8 tokenized widths, spacing and control geometry |

The six introduced discard-dialog samples reflect D15: 1.3.3 used a native confirmation without DOM styles; 1.4.0 uses the app modal. There are no unexplained matched-node differences. The permanent ownership guard consolidates **28 duplicate selectors** and checks viewport-block ownership without exceptions.

## Selected images

| Area | Before | After |
| --- | --- | --- |
| Dashboard | [1.4.0](images/releases/1.4.1/before-chromium-dashboard-default-dark-1440.jpg) | [1.4.1](images/releases/1.4.1/after-chromium-dashboard-default-dark-1440.jpg) |
| Display | [One page](images/releases/1.4.1/before-chromium-settings-Display-default-dark-1440.jpg) | [Lists & columns](images/releases/1.4.1/after-chromium-display-Lists-and-columns-default-dark-1440.jpg), [Colors](images/releases/1.4.1/after-chromium-display-Colors-default-dark-1440.jpg) |
| Mobile placement | [1.4.0](images/releases/1.4.1/before-chromium-Disk-default-dark-375.jpg) | [1.4.1](images/releases/1.4.1/after-chromium-Disk-default-dark-375.jpg) |

There is no schema migration. Tool presets reuse existing namespaces and are hidden by 1.4.0 on rollback. Dependencies remain at the approved 1.4.0 versions. Approved release gates publication on exact-main CI, both architecture smoke tests and vulnerability scans, and the 100,000-file container check with **512 MiB and no additional swap**. Commits and release metadata use the maintainer identity without assistant attribution.
