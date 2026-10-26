These JSON samples use the real MediaInfo --Output=JSON --Full schema with synthetic metadata; they contain no private media. They cover AVC/x264, HEVC/x265 and Dolby Vision/HDR10, interlaced MPEG-2, XviD and ambiguous multiple videos. A real CLI smoke test is provided by scripts/check-mediainfo.sh.

`pcm-cli-25.09.json` is unmodified real output from Alpine MediaInfo 25.09 (`--Output=JSON --Full /fixture.wav`) reading the generated `testdata/mux120.wav` PCM fixture on 2026-10-26. The referenced path is a test-container mount.
