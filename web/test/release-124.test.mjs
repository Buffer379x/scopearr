import test from "node:test";
import assert from "node:assert/strict";
import { routineMuxMessages } from "../src/mux-spec.ts";

test("status dialog suppresses routine progress but retains actionable messages", () => {
  for (const message of [
    "Ready",
    "Queued",
    "Checking media file",
    "Muxing",
    "Verifying",
    "Moving output",
    "Replacing",
    "Rescanning",
    "Mux completed",
  ]) {
    assert.ok(routineMuxMessages.has(message), message);
  }
  for (const message of [
    "Media file changed. Identify it again",
    "Review track selection",
    "Interrupted by restart",
    "Interrupted during replacement. Verified output has been preserved",
    "Original preserved as backup because Arr deletion failed",
    "Output verification failed",
  ]) {
    assert.equal(routineMuxMessages.has(message), false, message);
  }
});
