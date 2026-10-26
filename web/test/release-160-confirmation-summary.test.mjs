import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasActiveFieldConfirmation } from "../src/confirmation-summary.ts";
import { channelRows } from "../src/audio-channels.ts";
const track = {
  index: 1,
  codec: "DTS",
  language: "Englisch",
  channelLayout: "5.1",
  channels: 6,
};
test("channel summaries honor active confirmed scalar and retain raw track evidence", () => {
  for (const [source, key] of [
    ["filename", "filename"],
    ["api", "api"],
    ["mediaServer", "emby"],
    ["mediainfo", "mediainfo"],
  ]) {
    const f = {
      channels: "2.0 + 7.1",
      audioTracks: [track],
      evidence: {
        channels: { [key]: "2.0 + 7.1", confirmed: { source, value: "old" } },
      },
    };
    assert.deepEqual(channelRows(f), ["2.0", "7.1"]);
    assert.deepEqual(f.audioTracks, [track]);
    f.evidence.channels[key] = "";
    assert.deepEqual(channelRows(f), ["5.1"]);
  }
});
test("AudioCell suppresses track pairing only for active audio/language confirmations", () => {
  const code = readFileSync(
    new URL("../src/components/AudioCell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(code, /hasActiveFieldConfirmation\(file, "audio"\)/);
  assert.match(code, /hasActiveFieldConfirmation\(file, "language"\)/);
  assert.match(code, /const mapping = tracks.length > 0 && !/);
  const details = readFileSync(
    new URL("../src/components/FileDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(details, /file\.audioTracks/);
});

test("active confirmation uses its current selected source for every field", () => {
  for (const field of [
    "resolution",
    "codec",
    "source",
    "processing",
    "hdr",
    "bitDepth",
    "audio",
    "channels",
    "language",
  ]) {
    for (const [source, key] of [
      ["filename", "filename"],
      ["api", "api"],
      ["mediaServer", "emby"],
      ["mediainfo", "mediainfo"],
    ]) {
      const evidence = {
        [field]: { [key]: "current", confirmed: { source, value: "old" } },
      };
      assert.equal(hasActiveFieldConfirmation({ evidence }, field), true);
      evidence[field][key] = "";
      assert.equal(hasActiveFieldConfirmation({ evidence }, field), false);
      evidence[field][key] = " ";
      assert.equal(hasActiveFieldConfirmation({ evidence }, field), false);
    }
    assert.equal(
      hasActiveFieldConfirmation(
        { evidence: { [field]: { filename: "value" } } },
        field,
      ),
      false,
    );
    assert.equal(
      hasActiveFieldConfirmation(
        {
          evidence: {
            [field]: {
              filename: "value",
              confirmed: { source: "missing", value: "saved" },
            },
          },
        },
        field,
      ),
      false,
    );
  }
  assert.equal(hasActiveFieldConfirmation({}, "audio"), false);
});
