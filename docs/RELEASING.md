# Releases and versioning

Public source: `Buffer379x/scopearr`. Public images: `ghcr.io/buffer379x/scopearr`. Version 0.1.0 is published. The stable channel changes only after an approved release succeeds; normal pushes do not deploy an update.

## Prepare every change batch

1. Update root `VERSION` using semantic versioning. Use a minor bump for new features and a patch bump for fixes. Never reuse a released version.
2. Match `web/package.json` and both Docker `ARG VERSION` defaults. Local Go builds embed `VERSION` directly; release builds validate the override.
3. Add an English entry to `CHANGELOG.md` and `docs/releases/<version>.md`, describing behavior, validation, migrations and rollback implications.
4. Run `node scripts/check-version.mjs`, frontend tests/build and Go race/vet checks. On GitHub, CI also checks that changes after the latest release use a newer version. Rerunning checks on the exact released commit remains valid.
5. Review the working preview and wait for approval before dispatching a release.

## Publish an approved release

Run **Approved release** on `main`, using the exact version in `VERSION` without `v`. Existing version tags and mismatched source versions are rejected. The workflow:

- Rechecks translations, frontend, Go, audits, performance and version consistency.
- Builds and pushes versioned images for `linux/amd64` and `linux/arm64`.
- Starts both architectures, scans runtime images for known high/critical vulnerabilities and exercises 100,000 synthetic files under the container memory limit without swap.
- Creates the immutable version tag and GitHub release using the checked-in **English** notes file.
- Promotes the tested image digest to `stable` last.

The workflow uses the short-lived `GITHUB_TOKEN` with `contents:write` and `packages:write`; no PAT is committed. Third-party actions are pinned to commit SHAs. Dependabot proposes dependency updates. Verify that the GHCR package is **Public** and confirm an anonymous pull; public repository visibility alone does not ensure public package access.

If a run fails before promotion, stable remains unchanged. Inspect the failed stage before retrying, especially if versioned images or a release already exist. Do not overwrite published tags to bypass a failure.

## Downgrade check

CI checks that data written by the current build still starts the previous release, so a rollback keeps working: it sets up and saves settings with the new image, then signs in with 1.7.0 on the same data and compares the saved interface settings. Run it locally with `python3 scripts/check-downgrade.py --image scopearr:test --previous ghcr.io/buffer379x/scopearr:1.7.0` after `docker build -t scopearr:test .`.

## Install updates

Unraid: Docker → Check for Updates → Scopearr → Update. Compose: `docker compose pull` then `docker compose up -d`. Keep `/data` and its local key. See [operations](OPERATIONS.md) for backup and rollback. Scopearr does not perform automatic background pulls or access the Docker socket.
