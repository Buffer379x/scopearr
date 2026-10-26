# Contributing to Scopearr

Use English for public descriptions, documentation, changelogs and release notes. Interface translations are welcome: see [the translation guide](docs/TRANSLATING.md).

Keep library reads and tag writes narrowly scoped and preserve the last complete cache on failure. Local media access requires an explicitly enabled workflow: MKVToolNix track editing and file renaming use configured media mounts and path mappings; MediaInfo performs only user-requested, read-only file inspection. Arr file deletion, targeted rescans and library notifications remain limited to the applicable MKVToolNix or rename workflow. See [MUX.md](docs/MUX.md) and [MEDIAINFO.md](docs/MEDIAINFO.md). Never commit credentials, Appdata, personal templates or private library screenshots.

For changes after a release, bump `VERSION`, matching frontend package/Docker defaults, and add an English changelog/release entry. Run the checks in [README](README.md) and describe meaningful validation in your pull request. New releases are manually approved; normal pushes do not update stable.

Automated changes are attributed to the maintainer, `Buffer379x <122407181+Buffer379x@users.noreply.github.com>`. Do not add AI assistant authors, co-author trailers or generated-by footers to commits or pull request descriptions. Check the complete squash message before merging, because GitHub can copy trailers from individual commits into it. Repository-level assistant instructions are in `AGENTS.md` and `CLAUDE.md`.
