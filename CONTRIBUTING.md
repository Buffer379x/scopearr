# Contributing to Scopearr

Use English for public descriptions, documentation, changelogs and release notes. Interface translations are welcome: see [the translation guide](docs/TRANSLATING.md).

Keep library reads and tag writes narrowly scoped and preserve the last complete cache on failure. Media mounts, local identification, Arr file deletion/rescans and library notifications are allowed only in the explicitly enabled MKVToolNix workflow; see docs/MUX.md. Never commit credentials, Appdata, personal templates or private library screenshots.

For changes after a release, bump `VERSION`, matching frontend package/Docker defaults, and add an English changelog/release entry. Run the checks in [README](README.md) and describe meaningful validation in your pull request. New releases are manually approved; normal pushes do not update stable.

Automated changes are attributed to the maintainer, `Buffer379x <122407181+Buffer379x@users.noreply.github.com>`. Do not add AI assistant authors, co-author trailers or generated-by footers to commits or pull request descriptions. Check the complete squash message before merging, because GitHub can copy trailers from individual commits into it. Repository-level assistant instructions are in `AGENTS.md` and `CLAUDE.md`.
