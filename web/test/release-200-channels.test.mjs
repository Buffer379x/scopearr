import test from "node:test";
import assert from "node:assert/strict";
import { audioChannelLayout } from "../src/audio-channels.ts";

// 2.0.0 adds 1.0 and 6.1 filename defaults, not mono/stereo tokens. Track
// layouts keep the names 1.7.0 already showed (Go: mediaChannelLayout).
test("track layouts keep the 1.7.0 channel names", () => {
  assert.equal(audioChannelLayout({ channelLayout: "mono" }), "1.0");
  assert.equal(audioChannelLayout({ channelLayout: "stereo" }), "2.0");
  assert.equal(audioChannelLayout({ channelLayout: "6.1" }), "6.1");
  assert.equal(audioChannelLayout({ channels: 6 }), "6 ch");
});
